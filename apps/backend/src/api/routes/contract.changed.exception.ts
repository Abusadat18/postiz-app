import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import {
  ContractChanged,
  PLATFORM_CONTRACT_CHANGED,
  contractChangedIdentifier,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';

// PhantomPulse: when a request-time provider call (connect, analytics) finds
// that a platform changed its API, answer with the contract PhantomPulse reads
// to put that platform into maintenance, instead of a generic 500.
@Catch(ContractChanged)
export class ContractChangedExceptionFilter implements ExceptionFilter {
  catch(exception: ContractChanged, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();

    response.status(502).json({
      statusCode: 502,
      code: PLATFORM_CONTRACT_CHANGED,
      platform: contractChangedIdentifier(exception),
      message: exception.message.replace(/^\[[^\]]*\]\s*/, ''),
    });
  }
}
