import { Controller, Get, Inject, Module, Param, BadRequestException } from '@nestjs/common';
import { Public } from '../auth/auth';
import { PincodeService } from './pincode.service';

@Controller('public/pincodes')
export class PincodesController {
  constructor(@Inject(PincodeService) private readonly svc: PincodeService) {}

  /** Area, district and state for a PIN. Public: PINs are not personal data. */
  @Public() @Get(':pin')
  lookup(@Param('pin') pin: string) {
    if (!/^[1-9][0-9]{5}$/.test(pin)) throw new BadRequestException('Enter a valid 6-digit PIN code');
    return this.svc.lookup(pin);
  }
}

@Module({ controllers: [PincodesController], providers: [PincodeService], exports: [PincodeService] })
export class PincodesModule {}
