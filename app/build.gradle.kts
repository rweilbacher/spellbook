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
        // 31 (Android 12) is the floor because voice notes route microphone
        // input with AudioManager.setCommunicationDevice, which arrived there.
        // The startBluetoothSco path it replaced is deprecated and was never
        // worth carrying for a personal app on a phone running 16.
        minSdk = 31
        targetSdk = 35
        versionCode = 4
        versionName = "1.3"
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
    // Writing into whichever folder you pick for backups, through the grant
    // the system persists for us.
    implementation("androidx.documentfile:documentfile:1.0.1")
}
