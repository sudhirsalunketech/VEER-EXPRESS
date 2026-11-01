import { Body, Controller, Get, HttpCode, Inject, Param, Post } from '@nestjs/common';
import type { AuthUser } from '../../common/roles';
import { CurrentUser, Roles } from '../auth/decorators';
import { OrgService } from './org.service';

@Controller('org')
export class OrgController {
  constructor(@Inject(OrgService) private readonly org: OrgService) {}

  @Get('branches') @Roles('SUPER_ADMIN', 'ADMIN', 'ACCOUNTANT')
  branches(@CurrentUser() u: AuthUser) { return this.org.branches(u); }

  @Get('staff') @Roles('SUPER_ADMIN', 'ADMIN')
  staff(@CurrentUser() u: AuthUser) { return this.org.staff(u); }

  @Post('staff') @Roles('SUPER_ADMIN', 'ADMIN')
  create(@CurrentUser() u: AuthUser, @Body() body: unknown) { return this.org.createStaff(u, body); }

  @Post('staff/:id/deactivate') @HttpCode(200) @Roles('SUPER_ADMIN', 'ADMIN')
  deactivate(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.org.setActive(u, id, false); }

  @Post('staff/:id/activate') @HttpCode(200) @Roles('SUPER_ADMIN', 'ADMIN')
  activate(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.org.setActive(u, id, true); }
}
