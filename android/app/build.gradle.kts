import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// One version for every platform (see gradle.properties). versionCode must grow
// with each release: 1.3.0 -> 10300.
val appVersion = providers.gradleProperty("appVersion").get()
val versionParts = appVersion.split(".").map { it.toInt() }

// Release signing comes from CI secrets (see docs/android/README.md). Without
// them the release build is unsigned and the workflow doesn't publish it.
val keystorePath: String? = System.getenv("ANDROID_KEYSTORE_PATH")

android {
    namespace = "com.pengopal.aiusagetracker"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.pengopal.aiusagetracker"
        minSdk = 26
        targetSdk = 36
        versionName = appVersion
        versionCode = versionParts[0] * 10000 + versionParts[1] * 100 + versionParts[2]
    }

    signingConfigs {
        if (keystorePath != null) {
            create("release") {
                storeFile = file(keystorePath)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release")
        }
    }

    // github: installs from GitHub Releases and updates itself.
    // play:   for the Play Store, which handles updates (no self-updater).
    flavorDimensions += "store"
    productFlavors {
        create("github") {
            dimension = "store"
            buildConfigField("boolean", "SELF_UPDATE", "true")
        }
        create("play") {
            dimension = "store"
            buildConfigField("boolean", "SELF_UPDATE", "false")
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/coreAssets"))
}

kotlin {
    compilerOptions { jvmTarget.set(JvmTarget.JVM_17) }
}

// The shared core (../../core/src) ships inside the APK's assets as core/*.
val copyCore by tasks.registering(Sync::class) {
    from(rootProject.file("../core/src")) { include("*.js", "*.json") }
    into(layout.buildDirectory.dir("generated/coreAssets/core"))
}
tasks.named("preBuild") { dependsOn(copyCore) }

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2025.10.01")
    implementation(composeBom)
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-compose:1.11.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.4")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.glance:glance-appwidget:1.1.1")
    implementation("androidx.work:work-runtime-ktx:2.10.5")
    implementation("androidx.webkit:webkit:1.12.1")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20260814")
}
