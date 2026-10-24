# Keep WebView JS interface if you add one later
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
