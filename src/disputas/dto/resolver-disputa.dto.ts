import { IsIn, IsString, MinLength } from 'class-validator';

export class ResolverDisputaDto {
  @IsString()
  @MinLength(3)
  decision: string;

  @IsIn(['positivo', 'negativo'])
  impacto: 'positivo' | 'negativo';
}
