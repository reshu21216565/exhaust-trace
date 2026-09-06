import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { createApiRouter } from './api/routes';
import { createExtraApiRouter } from './api/extraRoutes';
import { createRemedyRouter } from './api/remedyRouter';
import { createFixStationRouter } from './api/fixStationRouter';


const possibleEnvPaths = [
  path.resolve(__dirname, '../.env'),
  path.resolve(__dirname, '../../.env'),
  path.resolve(process.cwd(), '.env')
];
const envPath = possibleEnvPaths.find(file => fs.existsSync(file));
if (envPath) {
  dotenv.config({ path: envPath });
}
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
  app.use('/api/v1', createExtraApiRouter(orchestrator));
  app.use('/api/v1/remedy', createRemedyRouter(orchestrator));
  app.use('/api/v1/fix-station', createFixStationRouter(orchestrator));


  return { app, server, orchestrator, socketServer };
}

if (require.main === module) {
  const PORT = process.env.PORT || 3001;
  const { server } = createApplication();
  
  server.listen(PORT, () => {
    console.log(`[Backend] ExhaustTrace runtime started on port ${PORT}`);
  });
}
