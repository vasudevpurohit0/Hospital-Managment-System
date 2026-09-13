import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { TherapySource } from '@prisma/client';
import { TherapyService } from './therapy.service';
import { OpenCourseDto, PerformSessionDto, ScheduleSessionDto } from './dto/therapy.dto';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@Controller('therapy')
export class TherapyController {
  constructor(private readonly therapy: TherapyService) {}

  /** The console's own list — pass `date=YYYY-MM-DD` for "today", `source` to narrow by entry point. */
  @Get('sessions')
  @RequirePermission('TherapySession', 'read')
  async listSessions(
    @Query('visitId') visitId?: string,
    @Query('date') date?: string,
    @Query('source') source?: TherapySource,
  ) {
    return this.therapy.listSessions({ visitId, date, source });
  }

  @Get('courses')
  @RequirePermission('TherapySession', 'read')
  async listCourses(@Query('visitId') visitId?: string, @Query('source') source?: TherapySource) {
    return this.therapy.listCourses({ visitId, source });
  }

  @Post('courses')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('TherapySession', 'create')
  async openCourse(@Body() dto: OpenCourseDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.therapy.openCourse(dto, user?.id);
  }

  @Post('sessions')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('TherapySession', 'create')
  async scheduleSession(@Body() dto: ScheduleSessionDto, @CurrentUser() user?: AuthenticatedUser) {
    return this.therapy.scheduleSession(dto, user?.id);
  }

  @Post('sessions/:id/perform')
  @RequirePermission('TherapySession', 'update')
  async performSession(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PerformSessionDto,
    @CurrentUser() user?: AuthenticatedUser,
  ) {
    return this.therapy.performSession(id, dto.notes, user?.id);
  }

  @Post('sessions/:id/cancel')
  @RequirePermission('TherapySession', 'update')
  async cancelSession(@Param('id', ParseUUIDPipe) id: string) {
    return this.therapy.cancelSession(id);
  }

  @Post('sessions/:id/no-show')
  @RequirePermission('TherapySession', 'update')
  async markNoShow(@Param('id', ParseUUIDPipe) id: string) {
    return this.therapy.markNoShow(id);
  }
}
