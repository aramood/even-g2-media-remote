package com.example.g2mediahelper

import fi.iki.elonen.NanoHTTPD
import fi.iki.elonen.NanoWSD
import java.io.IOException
import java.util.Collections
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

class MediaBridgeServer(
  private val repository: MediaSessionRepository,
) : NanoWSD("127.0.0.1", PORT) {
  private val json = Json {
    encodeDefaults = true
    ignoreUnknownKeys = true
  }

  private val sockets = Collections.synchronizedSet(mutableSetOf<EventSocket>())

  fun broadcastState(snapshot: HelperSnapshot) {
    val payload = json.encodeToString(
      StateEvent(
        state = snapshot.state,
        health = snapshot.health,
      ),
    )
    broadcast(payload)
  }

  fun broadcastCommandResult(
    command: String,
    result: CommandExecutionResult,
  ) {
    val payload = json.encodeToString(
      CommandResultEvent(
        command = command,
        ok = result.ok,
        message = result.message,
        state = result.snapshot.state,
        health = result.snapshot.health,
      ),
    )
    broadcast(payload)
  }

  override fun openWebSocket(handshake: IHTTPSession): WebSocket {
    return EventSocket(handshake)
  }

  override fun serveHttp(session: IHTTPSession): NanoHTTPD.Response {
    return try {
      when {
        session.method == NanoHTTPD.Method.OPTIONS -> noContent()
        session.uri == HEALTH_PATH && session.method == NanoHTTPD.Method.GET -> jsonResponse(
          json.encodeToString(repository.snapshot.value.health),
        )
        session.uri == STATE_PATH && session.method == NanoHTTPD.Method.GET -> jsonResponse(
          json.encodeToString(
            StateEnvelope(
              state = repository.snapshot.value.state,
              health = repository.snapshot.value.health,
            ),
          ),
        )
        session.uri == COMMAND_PATH && session.method == NanoHTTPD.Method.POST -> handleCommand(session)
        else -> jsonResponse(
          body = """{"error":"Not found"}""",
          status = NanoHTTPD.Response.Status.NOT_FOUND,
        )
      }
    } catch (exception: Exception) {
      jsonResponse(
        body = """{"error":"${exception.message ?: "internal_error"}"}""",
        status = NanoHTTPD.Response.Status.INTERNAL_ERROR,
      )
    }
  }

  private fun handleCommand(session: IHTTPSession): NanoHTTPD.Response {
    val bodyFiles = HashMap<String, String>()
    session.parseBody(bodyFiles)
    val body = bodyFiles["postData"].orEmpty()
    val request = json.decodeFromString(CommandRequest.serializer(), body)
    val result = repository.executeCommand(request)
    broadcastCommandResult(request.command, result)

    return jsonResponse(
      json.encodeToString(
        CommandResponse(
          ok = result.ok,
          command = request.command,
          message = result.message,
          state = result.snapshot.state,
          health = result.snapshot.health,
        ),
      ),
      status = if (result.ok) {
        NanoHTTPD.Response.Status.OK
      } else {
        NanoHTTPD.Response.Status.BAD_REQUEST
      },
    )
  }

  private fun noContent(): NanoHTTPD.Response {
    return withCors(
      NanoHTTPD.newFixedLengthResponse(NanoHTTPD.Response.Status.NO_CONTENT, MIME_JSON, ""),
    )
  }

  private fun jsonResponse(
    body: String,
    status: NanoHTTPD.Response.Status = NanoHTTPD.Response.Status.OK,
  ): NanoHTTPD.Response {
    return withCors(NanoHTTPD.newFixedLengthResponse(status, MIME_JSON, body))
  }

  private fun withCors(response: NanoHTTPD.Response): NanoHTTPD.Response {
    response.addHeader("Access-Control-Allow-Origin", "*")
    response.addHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    response.addHeader("Access-Control-Allow-Headers", "Content-Type")
    response.addHeader("Cache-Control", "no-store")
    return response
  }

  private fun broadcast(payload: String) {
    val staleSockets = mutableListOf<EventSocket>()
    synchronized(sockets) {
      sockets.forEach { socket ->
        try {
          socket.send(payload)
        } catch (_: IOException) {
          staleSockets += socket
        }
      }
      sockets.removeAll(staleSockets.toSet())
    }
  }

  inner class EventSocket(handshake: IHTTPSession) : WebSocket(handshake) {
    override fun onOpen() {
      if (handshakeRequest.uri != EVENTS_PATH) {
        try {
          close(WebSocketFrame.CloseCode.PolicyViolation, "Unsupported websocket path", false)
        } catch (_: IOException) {
          // Ignore close failures on bad handshake paths.
        }
        return
      }

      sockets += this
      try {
        send(
          json.encodeToString(
            StateEvent(
              state = repository.snapshot.value.state,
              health = repository.snapshot.value.health,
            ),
          ),
        )
      } catch (_: IOException) {
        sockets -= this
      }
    }

    override fun onClose(
      code: WebSocketFrame.CloseCode,
      reason: String,
      initiatedByRemote: Boolean,
    ) {
      sockets -= this
    }

    override fun onMessage(messageFrame: WebSocketFrame) {
      // v1 is server-push only.
    }

    override fun onPong(pongFrame: WebSocketFrame) {
      // No-op.
    }

    override fun onException(exception: IOException) {
      sockets -= this
    }
  }

  companion object {
    const val PORT = 28765
    private const val MIME_JSON = "application/json; charset=utf-8"
    private const val HEALTH_PATH = "/v1/health"
    private const val STATE_PATH = "/v1/state"
    private const val COMMAND_PATH = "/v1/command"
    private const val EVENTS_PATH = "/v1/events"
  }
}
