import { I18nResolver } from '../index';
import { Injectable } from '@nestjs/common';
import { I18nResolverOptions } from '../decorators/i18n-resolver-options.decorator';
import { I18nLanguages } from '../decorators/i18n-languages.decorator';

@Injectable()
export class HeaderResolver implements I18nResolver {
  constructor(
    @I18nResolverOptions()
    private keys: string[] = ['accept-language'],
  ) {}

  resolve(req: any) {
    let lang: string;

    for (const key of this.keys) {
      if (req.headers[key] !== undefined) {
        lang = req.headers[key];
        break;
      }
    }

    return lang;
  }
}
