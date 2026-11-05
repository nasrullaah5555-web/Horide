import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

android {
    namespace = "et.musride.passenger"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        // Permanent once published on Google Play (OWNER_ACTION_REGISTER OA-23 confirms it).
        applicationId = "et.musride.passenger"
        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        // Uses the version code from pubspec.yaml. When using split APKs, 1000 * ABI_VERSION
        // is added automatically by Flutter. (https://developer.android.com/studio/build/configure-apk-splits#configure-APK-versions)
        // You can force using the value of versionCode by specifying the `-P force-version-code-ignoring-abi=true`
        // flag during build.
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    // Release signing (T-046). The upload key never enters Git. It comes from either
    //  - android/key.properties (on the owner's computer; git-ignored), or
    //  - environment variables MUSRIDE_KEYSTORE_FILE, MUSRIDE_KEYSTORE_PASSWORD, MUSRIDE_KEY_ALIAS,
    //    MUSRIDE_KEY_PASSWORD (CI, from GitHub secrets).
    // Without either, a release build fails, unless MUSRIDE_ALLOW_DEBUG_SIGNING=true (CI compile
    // check only: such a build is signed with the debug key and can't be uploaded to Play).
    val keyProps = Properties().apply {
        val f = rootProject.file("key.properties")
        if (f.exists()) f.inputStream().use { load(it) }
    }
    fun secret(prop: String, env: String): String? =
        keyProps.getProperty(prop) ?: System.getenv(env)?.takeIf { it.isNotBlank() }
    val storeFilePath = secret("storeFile", "MUSRIDE_KEYSTORE_FILE")

    signingConfigs {
        if (storeFilePath != null) {
            create("release") {
                storeFile = file(storeFilePath)
                storePassword = secret("storePassword", "MUSRIDE_KEYSTORE_PASSWORD")
                keyAlias = secret("keyAlias", "MUSRIDE_KEY_ALIAS")
                keyPassword = secret("keyPassword", "MUSRIDE_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            signingConfig = when {
                storeFilePath != null -> signingConfigs.getByName("release")
                System.getenv("MUSRIDE_ALLOW_DEBUG_SIGNING") == "true" -> signingConfigs.getByName("debug")
                else -> null // refused below, only when a release build is actually requested
            }
            isMinifyEnabled = true
            isShrinkResources = true
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}

// Debug builds never need the release key; a release build without one stops here with a clear
// message instead of producing an unsigned file.
gradle.taskGraph.whenReady {
    val wantsRelease = allTasks.any { it.project == project && it.name.contains("Release") &&
        (it.name.startsWith("assemble") || it.name.startsWith("bundle")) }
    if (wantsRelease && android.buildTypes.getByName("release").signingConfig == null) {
        throw GradleException(
            "No release signing key. Create android/key.properties (docs/DEPLOYMENT_GUIDE.md §10) " +
                "or set the MUSRIDE_KEYSTORE_* variables."
        )
    }
}

