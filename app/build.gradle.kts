plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.spellbook"
    compileSdk = 35

    // A fixed key checked into the repo. Without this, each CI run generates a
    // fresh debug keystore, every APK is signed by a different key, and Android
    // refuses to install over the previous one — forcing an uninstall, which
    // deletes the book. Not a secret: it only signs this app for this phone.
    signingConfigs {
        create("spellbook") {
            storeFile = file("spellbook.keystore")
            storePassword = "spellbook"
            keyAlias = "spellbook"
            keyPassword = "spellbook"
            storeType = "PKCS12"
        }
    }

    defaultConfig {
        applicationId = "com.spellbook"
        minSdk = 29
        targetSdk = 35
        versionCode = 2
        versionName = "1.1"
    }

    buildTypes {
        debug {
            signingConfig = signingConfigs.getByName("spellbook")
        }
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("spellbook")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")
}
