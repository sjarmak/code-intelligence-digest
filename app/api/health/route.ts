/**
 * Health check endpoint for Render
 * GET /api/health
 */

import { NextResponse } from 'next/server';

export async function GET() {
  try {
    // Basic health check - can add DB ping later
    return NextResponse.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
