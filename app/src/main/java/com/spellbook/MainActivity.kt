package com.spellbook

import android.Manifest
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
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream

/**
 * A thin shell. All of the app is the web bundle in assets/; this class exists
 * to host it on a real origin, give it a file to write to, and wire up the
 * things a web page can't do for itself: the back button, the file picker, the
 * microphone, and the folder backups get copied into.
 */
class MainActivity : ComponentActivity() {

    private lateinit var web: WebView
    private var pendingFiles: ValueCallback<Array<Uri>>? = null
    private lateinit var picker: ActivityResultLauncher<Array<String>>
    private lateinit var micPermission: ActivityResultLauncher<String>
    private lateinit var folderPicker: ActivityResultLauncher<Uri?>

    lateinit var voice: VoiceRecorder
        private set
    lateinit var backups: Backups
        private set

    private var pendingBluetooth = false

    private val mediaDir: File get() = File(filesDir, "media")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Draw behind the system bars; the CSS uses env(safe-area-inset-*) to compensate.
        WindowCompat.setDecorFitsSystemWindows(window, false)

        mediaDir.mkdirs()
        backups = Backups(this)
        voice = VoiceRecorder(this) { emit(it) }

        picker = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
            pendingFiles?.onReceiveValue(if (uri != null) arrayOf(uri) else null)
            pendingFiles = null
        }

        // Asked for the first time the mic is tapped, never at launch.
        micPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            if (granted) voice.start(pendingBluetooth)
            else emit(JSONObject().put("kind", "voice").put("type", "denied"))
        }

        folderPicker = registerForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
            val ev = JSONObject().put("kind", "backup").put("type", "folder")
            if (uri != null) {
                backups.remember(uri)
                ev.put("message", "Backups will go to " + backups.label())
            }
            emit(ev)
        }

        // Serving assets over https://appassets.androidplatform.net rather than
        // file:// gives the page a proper secure origin, so storage behaves.
        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .addPathHandler("/media/", VoiceNotePathHandler())
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

    // --------------------------------------------------- called by the bridge

    fun startVoiceNote(preferBluetooth: Boolean) {
        pendingBluetooth = preferBluetooth
        if (voice.hasPermission()) {
            voice.start(preferBluetooth)
        } else {
            runCatching { micPermission.launch(Manifest.permission.RECORD_AUDIO) }
                .onFailure { emit(JSONObject().put("kind", "voice").put("type", "denied")) }
        }
    }

    fun pickBackupFolder() {
        runCatching { folderPicker.launch(null) }
    }

    /** The one channel back into the page. Everything asynchronous — routing,
     *  levels, a finished recording, a folder choice — arrives this way. */
    fun emit(payload: JSONObject) {
        runOnUiThread {
            if (!::web.isInitialized) return@runOnUiThread
            val arg = JSONObject.quote(payload.toString())
            runCatching {
                web.evaluateJavascript("window.onNative && window.onNative($arg)", null)
            }
        }
    }

    /**
     * Serves files/media over the same origin as the assets, so a voice note is
     * an ordinary <audio> tag and nothing has to loosen file access. The MIME
     * type is stated rather than guessed — the asset loader's guesser doesn't
     * know .m4a and falls back to text/plain, which the media stack refuses to
     * play. No range support, so seeking within a note won't work; at this
     * length that's fine, and it's the reason to change approach if voice notes
     * ever get long.
     */
    private inner class VoiceNotePathHandler : WebViewAssetLoader.PathHandler {
        override fun handle(path: String): WebResourceResponse {
            val file = File(mediaDir, path)
            if (!VoiceRecorder.safeName(path) || !file.isFile) return notFound()
            return runCatching {
                WebResourceResponse(
                    "audio/mp4", null, 200, "OK",
                    mapOf(
                        "Content-Length" to file.length().toString(),
                        "Cache-Control" to "no-store"
                    ),
                    FileInputStream(file)
                )
            }.getOrElse { notFound() }
        }

        private fun notFound() = WebResourceResponse(
            "text/plain", "utf-8", 404, "Not Found", emptyMap(), null
        )
    }

    // ------------------------------------------------------------- lifecycle

    override fun onPause() {
        super.onPause()
        // Leaving the app finishes a note rather than losing it.
        if (voice.isRecording) voice.stop()
        // Flush WebView's own caches; our data is already on disk after every edit.
        web.evaluateJavascript("void 0", null)
    }

    override fun onDestroy() {
        if (voice.isRecording) voice.cancel()
        web.destroy()
        super.onDestroy()
    }
}
