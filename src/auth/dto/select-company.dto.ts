import { IsString } from 'class-validator';

export class SelectCompanyDto {
  @IsString()
  pendingToken: string;

  @IsString()
  companyId: string;
}
