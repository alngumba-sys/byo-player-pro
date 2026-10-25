package com.hulet.byocollector

import android.content.Context

/**
 * The numbers this phone receives money on, entered in Settings.
 * telebirr: Ethiopian mobile (09xx / 07xx / +2519 / +2517).
 * M-Pesa:   Kenyan Safaricom line (07xx / 01xx / +2547 / +2541).
 * Tanzania: M-Pesa / Tigo Pesa / Airtel Money line (06xx / 07xx / +2556 / +2557).
 * Stored as international digits (2519..., 2547...). Empty = not set.
 */
object Numbers {
    private const val PREFS = "byo_collector"
    private const val K_TB = "recv_telebirr"
    private const val K_MP = "recv_mpesa"
    private const val K_TZ = "recv_tzmm"
    private const val K_LAST = "last_sms_seen"

    fun telebirr(ctx: Context) = p(ctx).getString(K_TB, "") ?: ""
    fun mpesa(ctx: Context) = p(ctx).getString(K_MP, "") ?: ""
    fun tzmm(ctx: Context) = p(ctx).getString(K_TZ, "") ?: ""
    fun save(ctx: Context, telebirr: String, mpesa: String, tzmm: String) =
        p(ctx).edit().putString(K_TB, telebirr).putString(K_MP, mpesa).putString(K_TZ, tzmm).apply()

    /** Returns 2556xxxxxxxx / 2557xxxxxxxx, "" for blank input, or null if it is not a valid Tanzanian mobile. */
    fun normTz(v: String): String? {
        val d = v.filter { it.isDigit() }
        if (d.isEmpty()) return ""
        return when {
            Regex("^0[67]\\d{8}$").matches(d) -> "255" + d.substring(1)
            Regex("^[67]\\d{8}$").matches(d) -> "255$d"
            Regex("^255[67]\\d{8}$").matches(d) -> d
            else -> null
        }
    }

    /** Returns 2519xxxxxxxx / 2517xxxxxxxx, "" for blank input, or null if it is not a valid Ethiopian mobile. */
    fun normEt(v: String): String? {
        val d = v.filter { it.isDigit() }
        if (d.isEmpty()) return ""
        return when {
            Regex("^0[79]\\d{8}$").matches(d) -> "251" + d.substring(1)
            Regex("^[79]\\d{8}$").matches(d) -> "251$d"
            Regex("^251[79]\\d{8}$").matches(d) -> d
            else -> null
        }
    }
    /** Returns 2547xxxxxxxx / 2541xxxxxxxx, "" for blank input, or null if it is not a valid Kenyan mobile. */
    fun normKe(v: String): String? {
        val d = v.filter { it.isDigit() }
        if (d.isEmpty()) return ""
        return when {
            Regex("^0[17]\\d{8}$").matches(d) -> "254" + d.substring(1)
            Regex("^[17]\\d{8}$").matches(d) -> "254$d"
            Regex("^254[17]\\d{8}$").matches(d) -> d
            else -> null
        }
    }
    /** 2519xxxxxxxx -> 09xx xxx xxxx (local display). */
    fun pretty(intl: String): String {
        if (intl.length != 12) return intl
        val local = "0" + intl.substring(3)
        return "${local.substring(0, 4)} ${local.substring(4, 7)} ${local.substring(7)}"
    }

    /** The last SMS of any kind this phone saw, so you can tell at a glance that reading works. */
    fun noteSeen(ctx: Context, line: String) = p(ctx).edit().putString(K_LAST, line).apply()
    fun lastSeen(ctx: Context) = p(ctx).getString(K_LAST, "") ?: ""

    private fun p(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
