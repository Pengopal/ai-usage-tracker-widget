package com.pengopal.aiusagetracker.core

import android.content.Context
import org.json.JSONObject

/**
 * Builds the script that loads the shared core (core/src, shipped as assets)
 * into a provider's page, and the small calls that run a reader there.
 *
 * Nothing is exposed to the page: results are left in a page variable keyed by
 * a random token and read back with evaluateJavascript. Only the interpreted
 * numbers come back; tokens and cookies never leave the page.
 */
object CoreScripts {
    private val MODULES = listOf("parsers", "interpret", "readers")

    @Volatile private var cached: String? = null

    fun bundle(context: Context): String = cached ?: synchronized(this) {
        cached ?: run {
            val read = { name: String -> context.assets.open("core/$name").bufferedReader().use { it.readText() } }
            build(MODULES.associateWith { read("$it.js") }, read("catalog.json"))
        }.also { cached = it }
    }

    /** Wraps each CommonJS module so `require('./x')` works inside the page. */
    fun build(sources: Map<String, String>, catalogJson: String): String = buildString {
        append("(function(){if(globalThis.__aiutCore)return;var defs={")
        for ((name, src) in sources) {
            append(JSONObject.quote("./$name")).append(":function(module,exports,require){\n").append(src).append("\n},")
        }
        append("};var json={\"./catalog.json\":").append(catalogJson).append("};var cache={};")
        append("function req(n){n=n.replace(/\\.js$/,'');if(n in json)return json[n];")
        append("if(!cache[n]){var m={exports:{}};cache[n]=m;defs[n](m,m.exports,req);}return cache[n].exports;}")
        append("globalThis.__aiutCore={readers:req('./readers'),interpret:req('./interpret').interpret};})();")
    }

    /** Starts one reader in the page; safe to inject again after a navigation. */
    fun call(id: String, token: String): String {
        val t = JSONObject.quote(token)
        val p = JSONObject.quote(id)
        return "(function(){var R=(window.__aiutResults=window.__aiutResults||{});if(R[$t]!==undefined)return;R[$t]=null;" +
            "(async function(){try{var res=await __aiutCore.readers[$p](null);" +
            "R[$t]=JSON.stringify(__aiutCore.interpret($p,res,Date.now()));}" +
            "catch(e){R[$t]=JSON.stringify({connected:true,error:String((e&&e.message)||e)});}})();})();"
    }

    /** Evaluates to the result JSON string, or null while the reader is running. */
    fun poll(token: String): String {
        val t = JSONObject.quote(token)
        return "(function(){var R=window.__aiutResults;return (R&&R[$t])||null;})()"
    }
}
