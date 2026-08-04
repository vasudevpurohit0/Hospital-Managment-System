import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';

const server = express();
let isAppInitialized = false;
let nestApp: any;

async function bootstrapServer() {
  if (!isAppInitialized) {
    nestApp = await NestFactory.create(AppModule, new ExpressAdapter(server));
    nestApp.setGlobalPrefix('api');
    nestApp.useGlobalFilters(new AllExceptionsFilter());
    nestApp.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    nestApp.enableCors();
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
    const app = await NestFactory.create(AppModule);
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.enableCors();
    app.enableShutdownHooks();

    const port = process.env.API_PORT || 3000;
    await app.listen(port);
    Logger.log(`🚀 Local Application is running on: http://localhost:${port}/api`);
  }
}

bootstrapLocal();
