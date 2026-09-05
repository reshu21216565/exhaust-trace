import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { createApiRouter } from './api/routes';
import { SocketServer } from './api/socket';
import { IncidentOrchestrator } from './orchestrator/IncidentOrchestrator';

export function createApplication() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const server = createServer(app);
  const socketServer = new SocketServer(server);
  
  const orchestrator = new IncidentOrchestrator((event) => {
    socketServer.broadcast(event);
  });

  app.use('/api/v1', createApiRouter(orchestrator));

  return { app, server, orchestrator, socketServer };
}

if (require.main === module) {
  const PORT = process.env.PORT || 3001;
  const { server } = createApplication();
  
  server.listen(PORT, () => {
    console.log(`[Backend] ExhaustTrace runtime started on port ${PORT}`);
  });
}
