import { Server as SocketIOServer } from 'socket.io';
import { Server as HttpServer } from 'http';
import { IncidentWsEvent } from '@exhausttrace/shared';

export class SocketServer {
  private io: SocketIOServer;

  constructor(server: HttpServer) {
    this.io = new SocketIOServer(server, {
      cors: { origin: '*' }
    });

    this.io.on('connection', (socket) => {
      console.log(`[WebSocket] Client connected: ${socket.id}`);
      socket.on('disconnect', () => {
        console.log(`[WebSocket] Client disconnected: ${socket.id}`);
      });
    });
  }

  public broadcast(event: IncidentWsEvent) {
    this.io.emit(event.type, event);
  }
}
