import { Controller, Get, Query } from '@nestjs/common';
import { UserService } from './user.service';
import { RequirePermission } from '../../common/decorators/permissions.decorator';

@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get()
  @RequirePermission('Admission', 'update')
  async findByRole(@Query('role') role?: string) {
    return this.userService.findByRole(role);
  }
}
