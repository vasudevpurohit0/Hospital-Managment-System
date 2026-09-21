import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ExpressAdapter, NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';
import { resolveCorsOrigins } from './common/config/cors.util';
import { PinoLoggerService } from './common/logging/pino-logger.service';

const server = express();
let isAppInitialized = false;
let nestApp: any;

async function bootstrapServer() {
  if (!isAppInitialized) {
    nestApp = await NestFactory.create(AppModule, new ExpressAdapter(server), { bufferLogs: true });
    nestApp.useLogger(nestApp.get(PinoLoggerService));
    // Patient registration posts photos as base64 data URLs (100KB+); the
    // Express default JSON limit (100kb) 500s those requests before any
    // guard/validation runs. 10MB comfortably fits a downscaled photo while
    // still rejecting absurd payloads.
    nestApp.useBodyParser('json', { limit: '10mb' });
    nestApp.useBodyParser('urlencoded', { limit: '10mb', extended: true });
    nestApp.setGlobalPrefix('api');
    nestApp.useGlobalFilters(new AllExceptionsFilter());
    nestApp.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    nestApp.enableCors({ origin: resolveCorsOrigins(), credentials: false });
    // V-04: this app runs behind exactly one reverse-proxy hop on Vercel --
    // without this, Express (and therefore the rate-limiter's per-IP
    // tracking) would see every visitor as the proxy's own address, sharing
    // one throttle bucket across the whole userbase instead of one per
    // actual client.
    nestApp.set('trust proxy', 1);
    await nestApp.init();
    isAppInitialized = true;
  }
}

// Export async serverless handler for Vercel
export default async (req: any, res: any) => {
  try {
    await bootstrapServer();
    server(req, res);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: 'Failed to bootstrap NestJS', message: msg });
  }
};

async function bootstrapLocal() {
  // If not running inside Vercel environment, start listening on local port
  if (!process.env.VERCEL) {
    const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
    app.useLogger(app.get(PinoLoggerService));
    // Same raised body limit as the serverless bootstrap above -- patient
    // registration posts photos as base64 data URLs (100KB+), which the
    // Express default JSON limit (100kb) rejects with a 500.
    app.useBodyParser('json', { limit: '10mb' });
    app.useBodyParser('urlencoded', { limit: '10mb', extended: true });
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.enableCors({ origin: resolveCorsOrigins(), credentials: false });
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
    app.enableShutdownHooks();

    const port = process.env.API_PORT || 3000;
    await app.listen(port);
    Logger.log(`🚀 Local Application is running on: http://localhost:${port}/api`);
  }
}

bootstrapLocal();
