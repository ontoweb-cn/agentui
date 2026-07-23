import SvgIcon from '@/components/svg-icon';
import { useAuth } from '@/hooks/auth-hooks';
import {
  useLogin,
  useLoginChannels,
  useLoginWithChannel,
  useRegister,
  useAuthMode,
} from '@/hooks/use-login-request';
import { useSystemConfig } from '@/hooks/use-system-request';
import { rsaPsw } from '@/utils';
import { useContext, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import Spotlight from '@/components/spotlight';
import { Button, ButtonLoading } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, UseFormReturn } from 'react-hook-form';
import { z } from 'zod';
import { NICKNAME_PATTERN } from '../user-setting/profile/constants';
import { BgSvg } from './bg';
import FlipCard3D, { FlipFaceContext } from './card';
import './index.less';

type LoginFormContentProps = {
  isLoginPage: boolean;
  title: string;
  form: UseFormReturn<any>;
  loading: boolean;
  onCheck: (params: any) => Promise<void>;
  changeTitle: () => void;
  registerEnabled: boolean;
  channels: { channel: string; icon?: string; display_name: string }[];
  handleLoginWithChannel: (channel: string) => void;
  t: ReturnType<typeof useTranslation>['t'];
  disablePasswordLogin?: boolean;
  isEnterprise?: boolean;
};

function LoginFormContent({
  isLoginPage,
  title,
  form,
  loading,
  onCheck,
  changeTitle,
  registerEnabled,
  channels,
  handleLoginWithChannel,
  t,
  disablePasswordLogin,
  isEnterprise,
}: LoginFormContentProps) {
  const face = useContext(FlipFaceContext);
  const isActiveFace = isLoginPage ? face === 'front' : face === 'back';

  return (
    <div className="flex flex-col items-center justify-center w-full">
      <div className="text-center mb-8">
        <h2 className="text-xl font-semibold text-text-primary">
          {title === 'login' ? t('loginTitle') : t('signUpTitle')}
        </h2>
      </div>
      <div className=" w-full max-w-[540px] bg-bg-component backdrop-blur-sm rounded-2xl shadow-xl pt-14 pl-10 pr-10 pb-2 border border-border-button ">
        {!disablePasswordLogin && (
          <Form {...form}>
            <form
              className="flex flex-col gap-8 text-text-primary "
              data-testid="auth-form"
              data-active={isActiveFace ? 'true' : undefined}
              onSubmit={form.handleSubmit(onCheck)}
            >
              {isEnterprise ? (
                <FormField
                  control={form.control}
                  name="login_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>{t('loginNameLabel')}</FormLabel>
                      <FormControl>
                        <Input
                          data-testid="auth-email"
                          placeholder={t('loginNamePlaceholder')}
                          autoComplete="username"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : (
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>{t('emailLabel')}</FormLabel>
                      <FormControl>
                        <Input
                          data-testid="auth-email"
                          placeholder={t('emailPlaceholder')}
                          autoComplete="email"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
              {title === 'register' && (
                isEnterprise ? (
                  <FormField
                    control={form.control}
                    name="display_name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel required>{t('displayNameLabel')}</FormLabel>
                        <FormControl>
                          <Input
                            data-testid="auth-nickname"
                            placeholder={t('displayNamePlaceholder')}
                            autoComplete="name"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ) : (
                  <FormField
                    control={form.control}
                    name="nickname"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel required>{t('nicknameLabel')}</FormLabel>
                        <FormControl>
                          <Input
                            data-testid="auth-nickname"
                            placeholder={t('nicknamePlaceholder')}
                            autoComplete="username"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )
              )}

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>{t('passwordLabel')}</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          data-testid="auth-password"
                          type={'password'}
                          placeholder={t('passwordPlaceholder')}
                          autoComplete={
                            title === 'login'
                              ? 'current-password'
                              : 'new-password'
                          }
                          {...field}
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {title === 'login' && (
                <FormField
                  control={form.control}
                  name="remember"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex gap-2 group">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={(checked) => {
                              field.onChange(checked);
                            }}
                            className="group-hover:border-border-default group-hover:bg-border-button"
                          />
                        </FormControl>
                        <FormLabel
                          className={cn('cursor-pointer', {
                            'text-text-disabled': !field.value,
                            'text-text-primary': field.value,
                          })}
                        >
                          {t('rememberMe')}
                        </FormLabel>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
              <ButtonLoading
                data-testid="auth-submit"
                type="submit"
                loading={loading}
                className="bg-metallic-gradient border-b-[#00BEB4] border-b-2 hover:bg-metallic-gradient hover:border-b-[#02bcdd] w-full my-8"
              >
                {title === 'login' ? t('login') : t('continue')}
              </ButtonLoading>
            </form>
          </Form>
        )}

        {title === 'login' && channels && channels.length > 0 && (
          <div className={disablePasswordLogin ? 'py-8' : 'mt-3 border'}>
            {channels.map((item) => (
              <Button
                variant={'transparent'}
                key={item.channel}
                onClick={() => handleLoginWithChannel(item.channel)}
                style={{ marginTop: 10 }}
                className={disablePasswordLogin ? 'w-full' : ''}
              >
                <div className="flex items-center">
                  <SvgIcon
                    name={item.icon || 'sso'}
                    width={20}
                    height={20}
                    style={{ marginRight: 5 }}
                  />
                  Sign in with {item.display_name}
                </div>
              </Button>
            ))}
          </div>
        )}

        {!disablePasswordLogin && title === 'login' && registerEnabled && (
          <div className="mt-10 text-right">
            <p className="text-text-disabled text-sm">
              {t('signInTip')}
              <Button
                data-testid="auth-toggle-register"
                variant={'transparent'}
                onClick={changeTitle}
                className="text-accent-primary/90 hover:text-accent-primary hover:bg-transparent font-medium border-none transition-colors duration-200"
              >
                {t('signUp')}
              </Button>
            </p>
          </div>
        )}
        {!disablePasswordLogin && title === 'register' && (
          <div className="mt-10 text-right">
            <p className="text-text-disabled text-sm">
              {t('signUpTip')}
              <Button
                data-testid="auth-toggle-login"
                variant={'transparent'}
                onClick={changeTitle}
                className="text-accent-primary/90 hover:text-accent-primary hover:bg-transparent font-medium border-none transition-colors duration-200"
              >
                {t('login')}
              </Button>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

const Login = () => {
  const [title, setTitle] = useState('login');
  const navigate = useNavigate();
  const { login, loading: signLoading } = useLogin();
  const { register, loading: registerLoading } = useRegister();
  const { channels, loading: channelsLoading } = useLoginChannels();
  const { login: loginWithChannel, loading: loginWithChannelLoading } =
    useLoginWithChannel();
  const { authMode, loading: authModeLoading } = useAuthMode();
  const { t } = useTranslation('translation', { keyPrefix: 'login' });
  const { t: tSetting } = useTranslation('translation', {
    keyPrefix: 'setting',
  });
  const [isLoginPage, setIsLoginPage] = useState(true);
  const isEnterprise = authMode === 'intellect-enterprise';

  const loading =
    signLoading ||
    registerLoading ||
    channelsLoading ||
    loginWithChannelLoading ||
    authModeLoading;
  const { config } = useSystemConfig();
  const registerEnabled = config?.registerEnabled !== 0;

  const { isLogin } = useAuth();
  useEffect(() => {
    if (isLogin) {
      navigate('/');
    }
  }, [isLogin, navigate]);

  const handleLoginWithChannel = async (channel: string) => {
    await loginWithChannel(channel);
  };

  const changeTitle = () => {
    setIsLoginPage(title !== 'login');
    if (title === 'login' && !registerEnabled) {
      return;
    }

    setTimeout(() => {
      setTitle(title === 'login' ? 'register' : 'login');
    }, 200);
  };

  const FormSchema = z
    .object({
      nickname: z.string().optional(),
      display_name: z.string().optional(),
      login_name: z.string().optional(),
      email: z.string().optional(),
      password: z.string().min(1, { message: t('passwordPlaceholder') }),
      remember: z.boolean().optional(),
    })
    .superRefine((data, ctx) => {
      if (isEnterprise) {
        // 企业版:login_name 必填
        if (!data.login_name || data.login_name.length < 1) {
          ctx.addIssue({
            path: ['login_name'],
            message: t('loginNamePlaceholder'),
            code: z.ZodIssueCode.custom,
          });
        }
        if (title === 'register') {
          if (!data.display_name || data.display_name.length < 1) {
            ctx.addIssue({
              path: ['display_name'],
              message: t('displayNamePlaceholder'),
              code: z.ZodIssueCode.custom,
            });
          }
        }
      } else {
        // 社区版:email 必填 + 格式校验
        if (!data.email || data.email.length < 1) {
          ctx.addIssue({
            path: ['email'],
            message: t('emailPlaceholder'),
            code: z.ZodIssueCode.custom,
          });
        } else if (!z.string().email().safeParse(data.email).success) {
          ctx.addIssue({
            path: ['email'],
            message: t('emailPlaceholder'),
            code: z.ZodIssueCode.custom,
          });
        }
        if (title === 'register') {
          if (!data.nickname) {
            ctx.addIssue({
              path: ['nickname'],
              message: 'nicknamePlaceholder',
              code: z.ZodIssueCode.custom,
            });
            return;
          }
          if (!NICKNAME_PATTERN.test(data.nickname)) {
            ctx.addIssue({
              path: ['nickname'],
              message: tSetting('usernameInvalidCharacters'),
              code: z.ZodIssueCode.custom,
            });
          }
        }
      }
    });
  type FormValues = z.infer<typeof FormSchema>;
  const form = useForm<FormValues>({
    defaultValues: {
      nickname: '',
      display_name: '',
      login_name: '',
      email: '',
      password: '',
      remember: false,
    },
    resolver: zodResolver(FormSchema),
  });

  const onCheck = async (params: FormValues) => {
    try {
      // 企业版模式:intellect-team 不支持 RSA 加密密码,接受明文(依赖 HTTPS 传输安全)
      // 社区版模式:intellect-rag 要求 RSA + Base64 加密
      const password = isEnterprise ? params.password : (rsaPsw(params.password) as string);

      if (title === 'login') {
        const loginField = isEnterprise
          ? { login_name: (params.login_name ?? '').trim() }
          : { email: (params.email ?? '').trim() };
        const code = await login({
          ...loginField,
          password,
        });
        if (code === 0) {
          navigate('/');
        }
      } else {
        if (isEnterprise) {
          const code = await register({
            login_name: params.login_name ?? '',
            display_name: params.display_name ?? '',
            password,
          });
          if (code === 0) {
            setTitle('login');
          }
        } else {
          const code = await register({
            nickname: params.nickname as string,
            email: params.email ?? '',
            password,
          });
          if (code === 0) {
            setTitle('login');
          }
        }
      }
    } catch (errorInfo) {
      console.log('Failed:', errorInfo);
    }
  };

  return (
    <>
      <Spotlight opcity={0.4} coverage={60} color={'rgb(128, 255, 248)'} />
      <Spotlight
        opcity={0.3}
        coverage={12}
        X={'10%'}
        Y={'-10%'}
        color={'rgb(128, 255, 248)'}
      />
      <Spotlight
        opcity={0.3}
        coverage={12}
        X={'90%'}
        Y={'-10%'}
        color={'rgb(128, 255, 248)'}
      />
      <div className=" h-[inherit] relative overflow-auto">
        <BgSvg isPaused />

        <div className="z-20 absolute top-3 flex flex-col items-center mb-12 w-full text-text-primary">
          <div className="flex items-center mb-4 w-full pl-10 pt-10 ">
            <div className="w-12 h-12 p-2 rounded-lg flex items-center justify-center mr-3">
              <img
                src={'/logo-96.png'}
                alt="logo"
                className="size-8 mr-[12] cursor-pointer"
              />
            </div>
            <div className="text-xl font-bold self-center">Intellect</div>
          </div>
          <h1 className="text-[36px] font-medium  text-center mb-2">
            {t('title')}
          </h1>
        </div>
        <div className="relative z-10 flex flex-col items-center justify-center min-h-[1050px] px-4 sm:px-6 lg:px-8">
          {/* Login Form */}
          <FlipCard3D isLoginPage={isLoginPage}>
            <LoginFormContent
              isLoginPage={isLoginPage}
              title={title}
              form={form}
              loading={loading}
              onCheck={onCheck}
              changeTitle={changeTitle}
              registerEnabled={registerEnabled}
              channels={channels || []}
              handleLoginWithChannel={handleLoginWithChannel}
              t={t}
              disablePasswordLogin={!!config?.disablePasswordLogin}
              isEnterprise={isEnterprise}
            />
          </FlipCard3D>
        </div>
      </div>
    </>
  );
};

export default Login;
