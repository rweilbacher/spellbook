package com.spellbook

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.WindowCompat
import androidx.webkit.WebViewAssetLoader

/**
 * A thin shell. All of the app is the web bundle in assets/; this class exists
 * to host it on a real origin, give it a file to write to, and wire up the
 * things a web page can't do for itself: the back button and the file picker.
 */
class MainActivity : ComponentActivity() {

    private lateinit var web: WebView
    private var pendingFiles: ValueCallback<Array<Uri>>? = null
    private lateinit var picker: ActivityResultLauncher<Array<String>>

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Draw behind the system bars; the CSS uses env(safe-area-inset-*) to compensate.
        WindowCompat.setDecorFitsSystemWindows(window, false)

        picker = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
            pendingFiles?.onReceiveValue(if (uri != null) arrayOf(uri) else null)
            pendingFiles = null
        }

        // Serving assets over https://appassets.androidplatform.net rather than
        // file:// gives the page a proper secure origin, so storage behaves.
        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        web = WebView(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(0xFF101216.toInt())   // no white flash on cold start

            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            settings.textZoom = 100                  // ignore system font scaling; the type is already tuned

            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(
                    view: WebView, request: WebResourceRequest
                ): WebResourceResponse? = loader.shouldInterceptRequest(request.url)

                override fun shouldOverrideUrlLoading(
                    view: WebView, request: WebResourceRequest
                ): Boolean {
                    val url = request.url
                    if (url.host == "appassets.androidplatform.net") return false
                    // Source links (tweets and such) open in the real browser.
                    runCatching { startActivity(Intent(Intent.ACTION_VIEW, url)) }
                    return true
                }
            }

            webChromeClient = object : WebChromeClient() {
                override fun onShowFileChooser(
                    view: WebView,
                    callback: ValueCallback<Array<Uri>>,
                    params: FileChooserParams
                ): Boolean {
                    pendingFiles?.onReceiveValue(null)
                    pendingFiles = callback
                    return runCatching {
                        picker.launch(arrayOf("application/json", "text/plain", "*/*")); true
                    }.getOrElse {
                        pendingFiles = null; false
                    }
                }
            }

            addJavascriptInterface(SpellbookBridge(this@MainActivity), "Android")
        }

        setContentView(web)
        web.loadUrl("https://appassets.androidplatform.net/assets/index.html")

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                web.evaluateJavascript("window.appBack ? window.appBack() : false") { handled ->
                    if (handled != "true") finish()
                }
            }
        })
    }

    override fun onPause() {
        super.onPause()
        // Flush WebView's own caches; our data is already on disk after every edit.
        web.evaluateJavascript("void 0", null)
    }

    override fun onDestroy() {
        web.destroy()
        super.onDestroy()
    }
}
