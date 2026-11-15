package dev.lazarus.necromancer.gateway

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteOpenHelper
import android.util.Log
import dev.lazarus.necromancer.store.LazarusDb
import java.util.UUID

/** [PendingInboxStore] over the `pending_inbox` table of `LazarusDb`. */
class SqlitePendingInboxStore(private val db: SQLiteOpenHelper) : PendingInboxStore {
  override fun maxSeq(): Long =
    db.readableDatabase.rawQuery("SELECT COALESCE(MAX(seq), 0) FROM pending_inbox", null).use { c ->
      if (c.moveToFirst()) c.getLong(0) else 0L
    }

  override fun insert(message: InboundMessage) {
    val values = ContentValues(5).apply {
      put("id", message.id)
      put("seq", message.seq)
      put("sender", message.sender)
      put("body", message.body)
      put("received_at", message.receivedAt)
    }
    db.writableDatabase.insertOrThrow("pending_inbox", null, values)
  }

  override fun loadAll(): List<InboundMessage> =
    db.readableDatabase
      .rawQuery("SELECT id, seq, sender, body, received_at FROM pending_inbox ORDER BY received_at, seq", null)
      .use { c ->
        val out = ArrayList<InboundMessage>(c.count)
        while (c.moveToNext()) out.add(InboundMessage(c.getString(0), c.getLong(1), c.getString(2), c.getString(3), c.getLong(4)))
        out
      }

  override fun delete(id: String) {
    db.writableDatabase.delete("pending_inbox", "id = ?", arrayOf(id))
  }
}

/**
 * Process singleton shared by `SmsReceiver`, `GatewayService` and the gateway native module.
 * Memory queue plus `pending_inbox`; see [InboxCore] for the rules.
 */
object InboxQueue {
  private const val TAG = "Lazarus"

  @Volatile private var core: InboxCore? = null

  fun get(context: Context): InboxCore =
    core ?: synchronized(this) {
      core ?: InboxCore(
        store = SqlitePendingInboxStore(LazarusDb.get(context)),
        newId = { UUID.randomUUID().toString() },
        log = { Log.i(TAG, it) },
      ).also { core = it }
    }
}
