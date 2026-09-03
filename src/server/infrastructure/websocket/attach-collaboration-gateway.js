import { WebSocketServer } from 'ws';

import { normalizeHostedEmail } from '../../domain/hosted-workspace-contract.js';
import {
  createRequestUrlWithPathname,
  stripBasePath,
} from '../http/http-request-helpers.js';
import { ClientSocketSession } from './client-socket-session.js';

function rejectUpgrade(socket, statusCode, statusMessage, {
  body = '',
  headers = {},
} = {}) {
  const headerLines = Object.entries(headers)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\r\n');
  const responseBody = String(body ?? '');
  const contentLengthHeader = responseBody
    ? `Content-Length: ${Buffer.byteLength(responseBody, 'utf8')}\r\n`
    : '';
  socket.write(
    `HTTP/1.1 ${statusCode} ${statusMessage}\r\n${headerLines}${headerLines ? '\r\n' : ''}${contentLengthHeader}\r\n${responseBody}`,
  );
  socket.destroy();
}

function extractRoomName(pathname, wsBasePath) {
  const roomSegment = pathname.slice(wsBasePath.length + 1);
  return decodeURIComponent(roomSegment || 'default');
}

export function attachCollaborationGateway({
  authService,
  basePath = '',
  governanceSessionRegistry = null,
  heartbeatIntervalMs,
  hostedWorkspaceService = null,
  httpServer,
  maxPayload,
  roomRegistry,
  wsBasePath,
}) {
  const websocketServer = new WebSocketServer({
    maxPayload,
    noServer: true,
    perMessageDeflate: false,
  });
  const socketSessions = new Map();
  let isShuttingDown = false;
  let closePromise = null;
  const heartbeatTimer = setInterval(() => {
    websocketServer.clients.forEach((client) => {
      const sessionEntry = socketSessions.get(client);
      const session = sessionEntry?.session;
      if (!session) {
        return;
      }

      if (session.isAlive === false) {
        try {
          client.terminate();
        } catch {
          // Ignore termination errors while collecting dead clients.
        }
        return;
      }

      session.markHeartbeatPending();

      try {
        client.ping();
      } catch {
        try {
          client.terminate();
        } catch {
          // Ignore termination errors while pinging clients.
        }
      }
    });
  }, heartbeatIntervalMs);
  heartbeatTimer.unref?.();

  const unsubscribeHostedAccessChange = hostedWorkspaceService?.onAccessChanged?.(({ email }) => {
    websocketServer.clients.forEach((client) => {
      const entry = socketSessions.get(client);
      if (!entry || entry.userEmail !== email) {
        return;
      }

      try {
        client.close(4003, 'Workspace access changed');
      } catch {
        try {
          client.terminate();
        } catch {
          // Ignore termination errors while closing revoked sessions.
        }
      }
    });
  }) ?? (() => {});

  const closeForGovernanceAccessChange = (client) => {
    try {
      client.close(4403, 'Governance access changed');
    } catch {
      try {
        client.terminate();
      } catch {
        // Ignore termination errors while closing invalid governance sessions.
      }
    }
  };

  const unsubscribeGovernanceAccessChange = governanceSessionRegistry?.onAccessChanged?.(({
    documentPath,
    participantSessionId,
  }) => {
    websocketServer.clients.forEach((client) => {
      const entry = socketSessions.get(client);
      if (entry?.roomName !== documentPath
        || entry.governanceParticipantSessionId !== participantSessionId) {
        return;
      }

      closeForGovernanceAccessChange(client);
    });
  }) ?? (() => {});

  websocketServer.on('connection', (ws, req, requestUrl, user = null) => {
    const roomName = extractRoomName(requestUrl.pathname, wsBasePath);
    const hasGovernanceParticipantSessionId = requestUrl.searchParams.has('governanceParticipantSessionId');
    const hasGovernanceVersion = requestUrl.searchParams.has('governanceVersion');
    let governanceParticipantSessionId;

    if (hasGovernanceParticipantSessionId || hasGovernanceVersion) {
      governanceParticipantSessionId = requestUrl.searchParams.get('governanceParticipantSessionId');
      const rawGovernanceVersion = requestUrl.searchParams.get('governanceVersion');
      const governanceVersion = /^\d+$/.test(rawGovernanceVersion ?? '')
        ? Number(rawGovernanceVersion)
        : Number.NaN;
      if (!hasGovernanceParticipantSessionId
        || !hasGovernanceVersion
        || !governanceParticipantSessionId
        || !governanceSessionRegistry?.isConnectionCurrent({
          documentPath: roomName,
          participantSessionId: governanceParticipantSessionId,
          version: governanceVersion,
        })) {
        closeForGovernanceAccessChange(ws);
        return;
      }
    }

    const room = roomRegistry.getOrCreate(roomName);
    const session = new ClientSocketSession({
      onDisconnected: (disconnectedRoomName) => {
        socketSessions.delete(ws);
        const remaining = roomRegistry.rooms.get(disconnectedRoomName)?.clients.size ?? 0;
        console.log(`[ws] "${disconnectedRoomName}" disconnected (${remaining} active client(s))`);
      },
      onFailed: () => {
        socketSessions.delete(ws);
      },
      room,
      roomName,
      ws,
    });
    socketSessions.set(ws, {
      governanceParticipantSessionId,
      roomName,
      session,
      userEmail: normalizeHostedEmail(user?.email),
    });
    void session.initialize();
  });

  httpServer.on('upgrade', (req, socket, head) => {
    if (isShuttingDown) {
      rejectUpgrade(socket, 503, 'Server Shutting Down');
      return;
    }

    const originalRequestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const requestUrl = createRequestUrlWithPathname(
      originalRequestUrl,
      stripBasePath(originalRequestUrl.pathname, basePath),
    );
    const matchesRealtimeRoute =
      requestUrl.pathname === wsBasePath || requestUrl.pathname.startsWith(`${wsBasePath}/`);

    if (!matchesRealtimeRoute || requestUrl.pathname === wsBasePath) {
      rejectUpgrade(socket, 404, 'Not Found');
      return;
    }

    const authResult = authService.authorizeWebSocketRequest(req, requestUrl);
    if (!authResult.ok) {
      rejectUpgrade(socket, authResult.statusCode, authResult.statusMessage, authResult);
      return;
    }

    const authenticatedUser = authService.getAuthenticatedUser?.(req) ?? null;
    Promise.resolve(hostedWorkspaceService?.authorizeWorkspaceAccess?.({
      user: authenticatedUser,
    })).then((hostedAuthResult) => {
      if (hostedAuthResult && !hostedAuthResult.ok) {
        rejectUpgrade(socket, hostedAuthResult.statusCode, 'Forbidden', {
          body: hostedAuthResult.body?.error || 'Workspace access denied',
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
          },
        });
        return;
      }

      websocketServer.handleUpgrade(req, socket, head, (ws) => {
        websocketServer.emit('connection', ws, req, requestUrl, authenticatedUser);
      });
    }).catch((error) => {
      console.error('[ws] Hosted workspace authorization failed:', error.message);
      rejectUpgrade(socket, 500, 'Internal Server Error');
    });
  });

  async function close() {
    if (closePromise) {
      return closePromise;
    }

    isShuttingDown = true;
    clearInterval(heartbeatTimer);
    unsubscribeHostedAccessChange();
    unsubscribeGovernanceAccessChange();

    closePromise = new Promise((resolve, reject) => {
      const forceCloseTimer = setTimeout(() => {
        websocketServer.clients.forEach((client) => {
          try {
            client.terminate();
          } catch {
            // Ignore termination errors during forced shutdown.
          }
        });
      }, 1000);
      forceCloseTimer.unref?.();

      websocketServer.close((error) => {
        clearTimeout(forceCloseTimer);

        if (error) {
          reject(error);
          return;
        }

        resolve();
      });

      websocketServer.clients.forEach((client) => {
        try {
          client.close(1001, 'Server shutting down');
        } catch {
          // Ignore close errors during shutdown.
        }
      });
    });

    return closePromise;
  }

  return {
    close,
    websocketServer,
  };
}
