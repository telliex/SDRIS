import { Controller, Get } from '@nestjs/common';
@Controller('health')
export class HealthController {
  @Get('live') live(): { status: string } { return { status: 'ok' }; }
  // Dependency readiness is intentionally deferred until infrastructure is wired.
}
