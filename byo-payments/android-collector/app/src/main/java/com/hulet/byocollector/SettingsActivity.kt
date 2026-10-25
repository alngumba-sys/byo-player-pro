package com.hulet.byocollector

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.hulet.byocollector.databinding.ActivitySettingsBinding

/** Advanced / technical panel — hidden behind the Settings button on the home screen. */
class SettingsActivity : AppCompatActivity() {

    private lateinit var b: ActivitySettingsBinding
    private val ui = Handler(Looper.getMainLooper())

    private val permLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { refresh() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        b = ActivitySettingsBinding.inflate(layoutInflater)
        setContentView(b.root)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)
        title = "Settings"

        b.btnPerms.setOnClickListener { requestPerms() }
        b.btnSaveKey.setOnClickListener {
            val key = b.inputKey.text.toString().trim()
            if (key.isEmpty()) { toast("Enter the key first"); return@setOnClickListener }
            Backend.setApiKey(this, key)
            Log.event(this, "key updated")
            toast("Key saved ✓")
            Thread { Backend.flushQueue(applicationContext); Backlog.run(applicationContext) }.start()
            refresh()
        }
        b.btnSaveNumbers.setOnClickListener {
            val tb = Numbers.normEt(b.inputTelebirr.text.toString())
            val mp = Numbers.normKe(b.inputMpesa.text.toString())
            val tz = Numbers.normTz(b.inputTzmm.text.toString())
            if (tb == null) { toast("The telebirr number should look like 0912 345 678"); return@setOnClickListener }
            if (mp == null) { toast("The M-Pesa number should look like 0712 345 678"); return@setOnClickListener }
            if (tz == null) { toast("The Tanzania number should look like 0712 345 678"); return@setOnClickListener }
            if (tb.isEmpty() && mp.isEmpty() && tz.isEmpty()) { toast("Enter at least one number"); return@setOnClickListener }
            Numbers.save(this, tb, mp, tz)
            b.inputTelebirr.setText(if (tb.isEmpty()) "" else Numbers.pretty(tb))
            b.inputMpesa.setText(if (mp.isEmpty()) "" else Numbers.pretty(mp))
            b.inputTzmm.setText(if (tz.isEmpty()) "" else Numbers.pretty(tz))
            Log.event(this, "receiving numbers updated")
            toast("Numbers saved on this phone ✓")
            Thread {
                val err = Backend.saveNumbers(applicationContext, tb, mp, tz)
                ui.post {
                    if (err == null) toast("Numbers sent to the TVs ✓")
                    else toast("Saved here, but the TVs were not updated: $err")
                    Log.event(this, if (err == null) "numbers sent to server" else "numbers not sent: $err")
                }
            }.start()
        }
        b.btnTest.setOnClickListener {
            val txt = b.inputTest.text.toString()
            val isMpesa = txt.contains("Ksh", true) || txt.contains("M-PESA", true)
            if (isMpesa) {
                val r = MpesaParser.parse(txt)
                if (r.ok) { b.testResult.text = "OK  M-Pesa  Ksh ${r.amountExact}  from ${r.payerName ?: "?"} …${r.payerLast ?: "?"}  ref ${r.txnId}"; toast("Looks good ✓  Ksh ${r.amount}") }
                else { b.testResult.text = "Not a payment: ${r.reason}"; toast("Not a payment: ${r.reason}") }
            } else {
                val r = TelebirrParser.parse(txt)
                if (r.ok) { b.testResult.text = "OK  telebirr  ETB ${r.amountExact}  from ${r.payerName ?: "?"} ••••${r.payerLast4}  ref ${r.txnId}"; toast("Looks good ✓  ETB ${r.amount}") }
                else { b.testResult.text = "Not a payment: ${r.reason}"; toast("Not a payment: ${r.reason}") }
            }
        }
        b.btnFlush.setOnClickListener {
            val n = Backend.queueSize(this)
            Thread { Backend.flushQueue(applicationContext) }.start()
            toast(if (n == 0) "Nothing to retry" else "Retrying $n …")
            ui.postDelayed({ refresh() }, 1500)
        }

        Numbers.telebirr(this).let { if (it.isNotEmpty()) b.inputTelebirr.setText(Numbers.pretty(it)) }
        Numbers.mpesa(this).let { if (it.isNotEmpty()) b.inputMpesa.setText(Numbers.pretty(it)) }
        Numbers.tzmm(this).let { if (it.isNotEmpty()) b.inputTzmm.setText(Numbers.pretty(it)) }
        b.inputKey.setText(Backend.apiKey(this).let { if (it == "SET_ME_IN_SETTINGS") "" else it })
        refresh()
    }

    override fun onSupportNavigateUp(): Boolean { finish(); return true }

    private fun requestPerms() {
        val perms = mutableListOf(Manifest.permission.RECEIVE_SMS, Manifest.permission.READ_SMS)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
            perms.add(Manifest.permission.POST_NOTIFICATIONS)
        permLauncher.launch(perms.toTypedArray())
    }
    private fun hasSms() =
        ContextCompat.checkSelfPermission(this, Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED

    private fun refresh() {
        b.status.text = buildString {
            append(if (hasSms()) "SMS permission: GRANTED\n" else "SMS permission: NOT granted\n")
            append("Unsent (queued): ${Backend.queueSize(this@SettingsActivity)}\n")
            append("Backend: ${BuildConfig.SUPABASE_URL}")
        }
        b.events.text = Log.recent(this).ifBlank { "No technical events yet." }
    }
    private fun toast(m: String) = Toast.makeText(this, m, Toast.LENGTH_SHORT).show()
    override fun onDestroy() { ui.removeCallbacksAndMessages(null); super.onDestroy() }
}
