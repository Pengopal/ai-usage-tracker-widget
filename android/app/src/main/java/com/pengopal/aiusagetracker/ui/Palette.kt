package com.pengopal.aiusagetracker.ui

import androidx.compose.ui.graphics.Color
import com.pengopal.aiusagetracker.R
import com.pengopal.aiusagetracker.core.Level

// Same tokens as desktop/src/renderer/styles.css.
object Palette {
    val bg = Color(0xFF0E0E12)
    val raise = Color(0xFF17171D)
    val track = Color(0xFF23232B)
    val line = Color(0x12FFFFFF)
    val text = Color(0xFFECECF1)
    val muted = Color(0xFFA3A3AE)
    val faint = Color(0xFF80808C)
    val ok = Color(0xFF5FAE84)
    val warn = Color(0xFFD9944F)
    val danger = Color(0xFFDD6663)
    val accent = Color(0xFF6AA8FF)
    val onAccent = Color(0xFF08111F)
    val claude = Color(0xFFD97757)

    fun of(level: Level) = when (level) {
        Level.OK -> ok
        Level.WARN -> warn
        Level.DANGER -> danger
    }

    /** The pct text stays white until a limit is getting close, like the desktop. */
    fun pctText(level: Level) = if (level == Level.OK) text else of(level)

    fun logo(logo: String) = when (logo) {
        "i-claude" -> R.drawable.logo_claude
        "i-openai" -> R.drawable.logo_openai
        else -> R.drawable.logo_xai
    }

    fun logoTint(id: String) = if (id == "claude") claude else text
}
