import {
  DynamicModule,
  Global,
  Logger,
  MiddlewareConsumer,
  Module,
  NestModule,
  Provider,
} from '@nestjs/common';
import {
  I18N_OPTIONS,
  I18N_TRANSLATIONS,
  I18N_LANGUAGES,
  I18nTranslation,
  I18N_RESOLVERS,
} from './i18n.constants';
import { I18nService } from './services/i18n.service';
import { I18nRequestScopeService } from './services/i18n-request-scope.service';
import {
  I18nAsyncOptions,
  I18nOptions,
  I18nOptionsFactory,
  ResolverWithOptions,
  I18nOptionResolver,
} from './interfaces/i18n-options.interface';
import { ValueProvider } from '@nestjs/common/interfaces';
import { parseTranslations, getLanguages } from './utils/parse';
import * as path from 'path';
import { I18nLanguageMiddleware } from './middleware/i18n-language-middleware';
import { HttpAdapterHost, ModuleRef } from '@nestjs/core';
import { getI18nResolverOptionsToken } from './decorators/i18n-resolver-options.decorator';
import { shouldResolve } from './utils/util';

const logger = new Logger('I18nService');

const defaultOptions: Partial<I18nOptions> = {
  filePattern: '*.json',
  resolvers: [],
  saveMissing: true,
};

@Global()
@Module({})
export class I18nModule implements NestModule {
  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly moduleRef: ModuleRef,
  ) {}

  configure(consumer: MiddlewareConsumer): MiddlewareConsumer | void {
    const adapterName =
      this.httpAdapterHost.httpAdapter &&
      this.httpAdapterHost.httpAdapter.constructor &&
      this.httpAdapterHost.httpAdapter.constructor.name;

    if (adapterName === 'FastifyAdapter') {
      this.moduleRef
        .create(I18nLanguageMiddleware)
        .then(i18nLanguageMiddleware => {
          this.httpAdapterHost.httpAdapter
            .getInstance()
            .addHook('preHandler', (req, res, done) => {
              i18nLanguageMiddleware.use(req, res, done);
            });
        });
    } else {
      consumer.apply(I18nLanguageMiddleware).forRoutes('*');
    }
  }

  static forRoot(options: I18nOptions): DynamicModule {
    options = this.sanitizeI18nOptions(options);
    const i18nOptions: ValueProvider = {
      provide: I18N_OPTIONS,
      useValue: options,
    };

    const translationsProvider = {
      provide: I18N_TRANSLATIONS,
      useFactory: async (): Promise<I18nTranslation> => {
        try {
          return await parseTranslations(options);
        } catch (e) {
          logger.error('parsing translation error', e);
          return {};
        }
      },
    };

    const languagessProvider = {
      provide: I18N_LANGUAGES,
      useFactory: async (): Promise<string[]> => {
        try {
          return await getLanguages(options);
        } catch (e) {
          logger.error('failed getting languages', e);
          return [];
        }
      },
    };

    const resolversProvider = {
      provide: I18N_RESOLVERS,
      useValue: options.resolvers || [],
    };

    return {
      module: I18nModule,
      providers: [
        { provide: Logger, useValue: logger },
        I18nService,
        I18nRequestScopeService,
        i18nOptions,
        translationsProvider,
        languagessProvider,
        resolversProvider,
        ...this.createResolverProviders(options.resolvers),
      ],
      exports: [I18nService, I18nRequestScopeService, languagessProvider],
    };
  }

  static forRootAsync(options: I18nAsyncOptions): DynamicModule {
    const asyncOptionsProvider = this.createAsyncOptionsProvider(options);
    const asyncTranslationProvider = this.createAsyncTranslationProvider();
    const asyncLanguagesProvider = this.createAsyncLanguagesProvider();
    const resolversProvider = {
      provide: I18N_RESOLVERS,
      useValue: options.resolvers || [],
    };
    return {
      module: I18nModule,
      imports: options.imports || [],
      providers: [
        { provide: Logger, useValue: logger },
        asyncOptionsProvider,
        asyncTranslationProvider,
        asyncLanguagesProvider,
        I18nService,
        I18nRequestScopeService,
        resolversProvider,
        ...this.createResolverProviders(options.resolvers),
      ],
      exports: [I18nService, I18nRequestScopeService, asyncLanguagesProvider],
    };
  }

  private static createAsyncOptionsProvider(
    options: I18nAsyncOptions,
  ): Provider {
    if (options.useFactory) {
      return {
        provide: I18N_OPTIONS,
        useFactory: options.useFactory,
        inject: options.inject || [],
      };
    }
    return {
      provide: I18N_OPTIONS,
      useFactory: async (optionsFactory: I18nOptionsFactory) =>
        await optionsFactory.createI18nOptions(),
      inject: [options.useClass || options.useExisting],
    };
  }

  private static createAsyncTranslationProvider(): Provider {
    return {
      provide: I18N_TRANSLATIONS,
      useFactory: async (options: I18nOptions): Promise<I18nTranslation> => {
        options = this.sanitizeI18nOptions(options);
        try {
          return await parseTranslations(options);
        } catch (e) {
          logger.error('parsing translation error', e);
          return {};
        }
      },
      inject: [I18N_OPTIONS],
    };
  }

  private static createAsyncLanguagesProvider(): Provider {
    return {
      provide: I18N_LANGUAGES,
      useFactory: async (options: I18nOptions): Promise<string[]> => {
        options = this.sanitizeI18nOptions(options);
        try {
          return await getLanguages(options);
        } catch (e) {
          logger.error('parsing translation error', e);
          return [];
        }
      },
      inject: [I18N_OPTIONS],
    };
  }

  private static sanitizeI18nOptions(options: I18nOptions) {
    options = { ...defaultOptions, ...options };

    options.path = path.normalize(options.path + path.sep);
    if (!options.filePattern.startsWith('*.')) {
      options.filePattern = '*.' + options.filePattern;
    }

    return options;
  }

  private static createResolverProviders(resolvers?: I18nOptionResolver[]) {
    return (resolvers || [])
      .filter(shouldResolve)
      .reduce<Provider[]>((providers, r) => {
        if (r.hasOwnProperty('use') && r.hasOwnProperty('options')) {
          const resolver = r as ResolverWithOptions;
          const optionsToken = getI18nResolverOptionsToken(resolver.use);
          providers.push({
            provide: resolver.use,
            useClass: resolver.use,
            inject: [optionsToken],
          });
          providers.push({
            provide: optionsToken,
            useFactory: () => resolver.options,
          });
        } else {
          const optionsToken = getI18nResolverOptionsToken(r as Function);
          providers.push({
            provide: r,
            useClass: r,
            inject: [optionsToken],
          } as any);
          providers.push({
            provide: optionsToken,
            useFactory: () => undefined,
          });
        }

        return providers;
      }, []);
  }
}
