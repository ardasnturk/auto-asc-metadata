plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}
android {
    namespace = "com.example.notes"
    defaultConfig {
        applicationId = "com.example.quicknotes"
        versionCode = 51
        versionName = "5.1"
    }
}
