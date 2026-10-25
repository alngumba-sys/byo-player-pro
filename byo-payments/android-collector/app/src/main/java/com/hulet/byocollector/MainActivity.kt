package com.hulet.byocollector

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.LayoutInflater
import android.view.View
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.hulet.byocollector.databinding.ActivityMainBinding
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Friendly home screen for whoever watches the collector phone.
 * Big plain-English status + a list of payments it has caught. No jargon —
 * all the technical settings live behind the Settings button.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var b: ActivityMainBinding
    private val ui = Handler(Looper.getMainLooper())
    private val timeFmt = SimpleDateFormat("h:mm a · d MMM", Locale.getDefault())

    private val permLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { render() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        b = ActivityMainBinding.inflate(layoutInflater)
        setContentView(b.root)

        b.btnSettings.setOnClickListener { startActivity(Intent(this, SettingsActivity::class.java)) }
        b.btnFix.setOnClickListener {
            if (!hasSms()) requestPerms()
            else startActivity(Intent(this, SettingsActivity::class.java))
        }

        CollectorService.start(this)
        Thread { Backlog.run(applicationContext) }.start()
        // Ask for SMS permission on first open so it's ready.
        if (!hasSms()) requestPerms()
        tick()
    }

    override fun onResume() { super.onResume(); render() }

    private fun requestPerms() {
        val perms = mutableListOf(Manifest.permission.RECEIVE_SMS, Manifest.permission.READ_SMS)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
            perms.add(Manifest.permission.POST_NOTIFICATIONS)
        permLauncher.launch(perms.toTypedArray())
    }

    private fun hasSms() =
        ContextCompat.checkSelfPermission(this, Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED
    private fun keySet(): Boolean {
        val k = Backend.apiKey(this); return k.isNotBlank() && k != "SET_ME_IN_SETTINGS"
    }

    private fun render() {
        // ---- status card ----
        when {
            !hasSms() -> setStatus("⚠", "#F5C451", "Needs permission",
                "Tap below to let the app read payment messages.", "Allow messages")
            Numbers.telebirr(this).isEmpty() && Numbers.mpesa(this).isEmpty() -> setStatus("⚠", "#F5C451", "Add your number",
                "Enter the telebirr and/or M-Pesa number customers pay into.", "Open Settings")
            !keySet() -> setStatus("✓", "#F5C451", "Reading payments",
                "Payments are read on this phone. Add the connection key in Settings so they reach your TVs.", "Open Settings")
            else -> setStatus("✓", "#2BD4A7", "Working",
                "Watching for payments. Keep this phone on and connected.", null)
        }

        // ---- receiving numbers + last SMS ----
        val tb = Numbers.telebirr(this); val mp = Numbers.mpesa(this)
        b.numbersLine.text = listOfNotNull(
            if (tb.isNotEmpty()) "telebirr  ${Numbers.pretty(tb)}" else null,
            if (mp.isNotEmpty()) "M-Pesa  ${Numbers.pretty(mp)}" else null
        ).joinToString("\n").ifEmpty { "Not set. Add it in Settings." }
        b.lastSeenLine.text = Numbers.lastSeen(this).ifEmpty { "Nothing yet. Send yourself a payment to test." }

        // ---- today counter ----
        val n = PaymentLog.todayCount(this)
        b.todayLine.text = when (n) {
            0 -> "No payments yet today"
            1 -> "1 payment today"
            else -> "$n payments today"
        }

        // ---- list ----
        val items = PaymentLog.all(this)
        b.emptyLine.visibility = if (items.isEmpty()) View.VISIBLE else View.GONE
        b.paymentsList.removeAllViews()
        val inf = LayoutInflater.from(this)
        for (e in items.take(50)) {
            val row = inf.inflate(R.layout.row_payment, b.paymentsList, false)
            val icon = row.findViewById<android.widget.TextView>(R.id.rowIcon)
            val amt = row.findViewById<android.widget.TextView>(R.id.rowAmount)
            val meta = row.findViewById<android.widget.TextView>(R.id.rowMeta)
            val st = row.findViewById<android.widget.TextView>(R.id.rowStatus)

            val money = if (e.exact > 0) (if (e.exact % 1.0 == 0.0) e.exact.toLong().toString() else "%.2f".format(e.exact)) else e.amount.toString()
            val via = when (e.currency) { "KES" -> "M-Pesa"; "TZS" -> TzParser.wallet("", e.raw); else -> "telebirr" }
            amt.text = if (e.amount > 0) "${e.currency} $money" else "$via message"
            val who = listOfNotNull(e.payer, if (e.last4.isNullOrBlank()) null else if (e.last4.contains("*")) e.last4 else "•••• ${e.last4}").joinToString(" ").ifEmpty { via }
            meta.text = "$who · ${timeFmt.format(Date(e.timeMs))}"

            fun mark(i: String, c: Long, label: String) { icon.text = i; icon.setTextColor(c.toInt()); st.text = label; st.setTextColor(c.toInt()) }
            when (e.status) {
                "sent"      -> mark("✓", 0xFF2BD4A7, "TV unlocked")
                "local"     -> mark("✓", 0xFF2BD4A7, "Read ✓")
                "retry"     -> mark("✓", 0xFFF5C451, "Read · will send")
                "unmatched" -> mark("✓", 0xFFF5C451, "Read · no TV match")
                "partial"   -> mark("✓", 0xFFF5C451, "Read · too little")
                "held"      -> mark("✓", 0xFFF5C451, "Read · TV disabled")
                "error"     -> mark("✓", 0xFFF5C451, "Read · server issue")
                "unparsed" -> mark("?", 0xFFFF5C6C, "Not understood")
                else       -> mark("!", 0xFFFF5C6C, "Problem")
            }
            row.setOnClickListener { showDetails(e) }
            b.paymentsList.addView(row)
        }
    }

    private fun setStatus(icon: String, color: String, title: String, sub: String, fixLabel: String?) {
        b.statusIcon.text = icon
        b.statusIcon.setTextColor(android.graphics.Color.parseColor(color))
        b.statusTitle.text = title
        b.statusSub.text = sub
        if (fixLabel != null) { b.btnFix.text = fixLabel; b.btnFix.visibility = View.VISIBLE }
        else b.btnFix.visibility = View.GONE
    }

    private fun showDetails(e: PaymentLog.Entry) {
        val body = buildString {
            append("Amount:  ${e.currency} ${if (e.exact > 0) e.exact else if (e.amount > 0) e.amount else "?"}\n")
            append("From:    ${e.payer ?: ""} •••• ${e.last4 ?: "?"}\n")
            append("When:    ${timeFmt.format(Date(e.timeMs))}\n")
            append("Ref:     ${e.txnId ?: "?"}\n")
            append("Status:  ${e.detail}\n\n")
            append("Original message:\n${e.raw}")
        }
        val canSend = e.status != "sent" && e.raw.isNotBlank()
        val dlg = AlertDialog.Builder(this)
            .setTitle("Payment details")
            .setMessage(body)
            .setPositiveButton("Close", null)
        if (canSend) dlg.setNeutralButton("Send to TV now") { _, _ -> resend(e) }
        dlg.show()
    }

    /** Send a payment this phone read (for example with an older version) to the TV system. */
    private fun resend(e: PaymentLog.Entry) {
        val tz = e.currency == "TZS"
        val mp = !tz && (e.currency == "KES" || e.raw.contains("Ksh", true))
        val item = if (tz) {
            val p = TzParser.parse(e.raw); if (!p.ok) { toast("Can't read this message: ${p.reason}"); return }
            Backend.item("tzmm", p.txnId, p.amountExact, "TZS", p.payerName, p.payerMasked, p.paidAt, e.raw)
        } else if (mp) {
            val p = MpesaParser.parse(e.raw); if (!p.ok) { toast("Can't read this message: ${p.reason}"); return }
            Backend.item("mpesa", p.txnId, p.amountExact, "KES", p.payerName, p.payerMasked, p.paidAt, e.raw)
        } else {
            val p = TelebirrParser.parse(e.raw); if (!p.ok) { toast("Can't read this message: ${p.reason}"); return }
            Backend.item("telebirr", p.txnId, p.amountExact, "ETB", p.payerName, p.payerMasked, p.paidAt, e.raw)
        }
        toast("Sending…")
        Thread {
            val r = Backend.sendOrQueue(applicationContext, item)
            val st = when (r.result) { "matched", "duplicate" -> "sent"; "queued" -> "retry"; "unmatched" -> "unmatched"; "partial" -> "partial"; "held" -> "held"; else -> "error" }
            PaymentLog.update(applicationContext, e.timeMs, st, if (r.result == "matched") "Matched: ${r.detail}" else r.detail)
            ui.post {
                toast(when (r.result) { "matched" -> "TV unlocked ✓"; "duplicate" -> "Already received"; "unmatched" -> "No TV is waiting for this payment"; "partial" -> "Too little for the plan"; "queued" -> "No internet, will retry"; else -> "Problem: ${r.detail}" })
                render()
            }
        }.start()
    }
    private fun toast(m: String) = android.widget.Toast.makeText(this, m, android.widget.Toast.LENGTH_LONG).show()

    private fun tick() { render(); ui.postDelayed({ tick() }, 4000) }
    override fun onDestroy() { ui.removeCallbacksAndMessages(null); super.onDestroy() }
}
