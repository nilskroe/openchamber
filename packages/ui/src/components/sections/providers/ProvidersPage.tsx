import React from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollableOverlay } from '@/components/ui/ScrollableOverlay';
import { ProviderLogo } from '@/components/ui/ProviderLogo';
import { useConfigStore } from '@/stores/useConfigStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { RiStackLine, RiToolsLine, RiBrainAi3Line, RiFileImageLine, RiArrowDownSLine, RiCheckLine, RiSearchLine } from '@remixicon/react';
import { reloadOpenCodeConfiguration } from '@/stores/useAgentsStore';
import { cn } from '@/lib/utils';
import type { ModelMetadata } from '@/types';
import { formatCompactNumber } from '@/lib/i18n';

const formatTokens = (value?: number | null) => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return null;
  }
  if (value === 0) {
    return '0';
  }
  const formatted = formatCompactNumber(value);
  return formatted.endsWith('.0') ? formatted.slice(0, -2) : formatted;
};

const ADD_PROVIDER_ID = '__add_provider__';

interface AuthMethod {
  type?: string;
  name?: string;
  label?: string;
  description?: string;
  help?: string;
  method?: number;
  [key: string]: unknown;
}

interface ProviderOption {
  id: string;
  name?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const normalizeAuthType = (method: AuthMethod) => {
  const raw = typeof method.type === 'string' ? method.type : '';
  const label = `${method.name ?? ''} ${method.label ?? ''}`.toLowerCase();
  const merged = `${raw} ${label}`.toLowerCase();
  if (merged.includes('oauth')) return 'oauth';
  if (merged.includes('api')) return 'api';
  return raw.toLowerCase();
};

const parseAuthPayload = (payload: unknown): Record<string, AuthMethod[]> => {
  if (!isRecord(payload)) {
    return {};
  }
  const result: Record<string, AuthMethod[]> = {};
  for (const [providerId, value] of Object.entries(payload)) {
    if (Array.isArray(value)) {
      result[providerId] = value.filter((entry) => isRecord(entry)) as AuthMethod[];
    }
  }
  return result;
};

const normalizeProviderEntry = (entry: unknown): ProviderOption | null => {
  if (typeof entry === 'string') {
    return { id: entry };
  }
  if (!isRecord(entry)) {
    return null;
  }
  const idCandidate =
    (typeof entry.id === 'string' && entry.id) ||
    (typeof entry.providerID === 'string' && entry.providerID) ||
    (typeof entry.slug === 'string' && entry.slug) ||
    (typeof entry.name === 'string' && entry.name);
  if (!idCandidate) {
    return null;
  }
  const nameCandidate = typeof entry.name === 'string' ? entry.name : undefined;
  return { id: idCandidate, name: nameCandidate };
};

const parseProvidersPayload = (payload: unknown): ProviderOption[] => {
  let entries: unknown[] = [];

  if (Array.isArray(payload)) {
    entries = payload;
  } else if (isRecord(payload)) {
    if (Array.isArray(payload.all)) {
      entries = payload.all;
    } else if (Array.isArray(payload.providers)) {
      entries = payload.providers;
    }
  }

  const mapped = entries
    .map((entry) => normalizeProviderEntry(entry))
    .filter((entry): entry is ProviderOption => Boolean(entry));

  const seen = new Set<string>();
  return mapped.filter((entry) => {
    if (seen.has(entry.id)) {
      return false;
    }
    seen.add(entry.id);
    return true;
  });
};

export const ProvidersPage: React.FC = () => {
  const { t } = useTranslation(['settings', 'common']);
  const providers = useConfigStore((state) => state.providers);
  const selectedProviderId = useConfigStore((state) => state.selectedProviderId);
  const setSelectedProvider = useConfigStore((state) => state.setSelectedProvider);
  const loadProviders = useConfigStore((state) => state.loadProviders);
  const getModelMetadata = useConfigStore((state) => state.getModelMetadata);

  const [authMethodsByProvider, setAuthMethodsByProvider] = React.useState<Record<string, AuthMethod[]>>({});
  const [authLoading, setAuthLoading] = React.useState(false);
  const [apiKeyInputs, setApiKeyInputs] = React.useState<Record<string, string>>({});
  const [authBusyKey, setAuthBusyKey] = React.useState<string | null>(null);
  const [modelQuery, setModelQuery] = React.useState('');
  const [pendingOAuth, setPendingOAuth] = React.useState<{ providerId: string; methodIndex: number } | null>(null);
  const [oauthCodes, setOauthCodes] = React.useState<Record<string, string>>({});
  const [oauthDetails, setOauthDetails] = React.useState<Record<string, { url?: string; instructions?: string; userCode?: string }>>({});
  const [availableProviders, setAvailableProviders] = React.useState<ProviderOption[]>([]);
  const [availableLoading, setAvailableLoading] = React.useState(false);
  const [availableError, setAvailableError] = React.useState<string | null>(null);
  const [candidateProviderId, setCandidateProviderId] = React.useState('');
  const [providerSearchQuery, setProviderSearchQuery] = React.useState('');
  const [providerDropdownOpen, setProviderDropdownOpen] = React.useState(false);

  React.useEffect(() => {
    if (!selectedProviderId && providers.length > 0) {
      setSelectedProvider(providers[0].id);
    }
  }, [providers, selectedProviderId, setSelectedProvider]);

  React.useEffect(() => {
    let isMounted = true;

    const loadAuthMethods = async () => {
      setAuthLoading(true);
      try {
        const response = await fetch('/api/provider/auth', {
          method: 'GET',
          headers: { Accept: 'application/json' },
        });

        if (!response.ok) {
          throw new Error(`Auth methods request failed (${response.status})`);
        }

        const payload = await response.json().catch(() => ({}));
        if (!isMounted) return;
        setAuthMethodsByProvider(parseAuthPayload(payload));
      } catch (error) {
        if (!isMounted) return;
        console.error('Failed to load provider auth methods:', error);
        toast.error(t('settings:providers.loadAuthFailed'));
      } finally {
        if (isMounted) {
          setAuthLoading(false);
        }
      }
    };

    loadAuthMethods();

    return () => {
      isMounted = false;
    };
  }, [t]);

  React.useEffect(() => {
    let isMounted = true;

    const loadAvailableProviders = async () => {
      setAvailableLoading(true);
      setAvailableError(null);
      try {
        const response = await fetch('/api/provider', {
          method: 'GET',
          headers: { Accept: 'application/json' },
        });

        if (!response.ok) {
          throw new Error(`Provider list request failed (${response.status})`);
        }

        const payload = await response.json().catch(() => ({}));
        if (!isMounted) return;
        setAvailableProviders(parseProvidersPayload(payload));
      } catch (error) {
        if (!isMounted) return;
        console.error('Failed to load available providers:', error);
        setAvailableError(t('settings:providers.loadListFailed'));
      } finally {
        if (isMounted) {
          setAvailableLoading(false);
        }
      }
    };

    loadAvailableProviders();

    return () => {
      isMounted = false;
    };
  }, [t]);

  const connectedProviderIds = React.useMemo(
    () => new Set(providers.map((provider) => provider.id)),
    [providers]
  );

  const unconnectedProviders = React.useMemo(
    () => availableProviders.filter((provider) => !connectedProviderIds.has(provider.id)),
    [availableProviders, connectedProviderIds]
  );

  React.useEffect(() => {
    if (selectedProviderId !== ADD_PROVIDER_ID) {
      return;
    }

    if (!candidateProviderId && unconnectedProviders.length > 0) {
      setCandidateProviderId(unconnectedProviders[0].id);
      return;
    }

    if (candidateProviderId && !unconnectedProviders.some((provider) => provider.id === candidateProviderId)) {
      setCandidateProviderId(unconnectedProviders[0]?.id ?? '');
    }
  }, [selectedProviderId, candidateProviderId, unconnectedProviders]);

  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId);

  const handleSaveApiKey = async (providerId: string) => {
    const apiKey = apiKeyInputs[providerId]?.trim() ?? '';
    if (!apiKey) {
      toast.error(t('common:validation.required'));
      return;
    }

    const busyKey = `api:${providerId}`;
    setAuthBusyKey(busyKey);

    try {
      const response = await fetch(`/api/auth/${encodeURIComponent(providerId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'api', key: apiKey }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message = payload?.error || 'Failed to save API key';
        throw new Error(message);
      }

      toast.success(t('settings:providers.apiKeySaved'));
      setApiKeyInputs((prev) => ({ ...prev, [providerId]: '' }));
      await reloadOpenCodeConfiguration();
      await loadProviders();
      setSelectedProvider(providerId);
    } catch (error) {
      console.error('Failed to save API key:', error);
      toast.error(t('settings:providers.apiKeySaveFailed'));
    } finally {
      setAuthBusyKey(null);
    }
  };

  const handleOAuthStart = async (providerId: string, methodIndex: number) => {
    const busyKey = `oauth:${providerId}:${methodIndex}`;
    setAuthBusyKey(busyKey);

    try {
      const response = await fetch(`/api/provider/${encodeURIComponent(providerId)}/oauth/authorize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: methodIndex }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message = payload?.error || 'Failed to start OAuth flow';
        throw new Error(message);
      }

      const payloadRecord = isRecord(payload) ? payload : {};
      const dataRecord = isRecord(payloadRecord.data) ? payloadRecord.data : payloadRecord;
      const urlCandidate =
        (typeof dataRecord.url === 'string' && dataRecord.url) ||
        (typeof dataRecord.verification_uri_complete === 'string' && dataRecord.verification_uri_complete) ||
        (typeof dataRecord.verification_uri === 'string' && dataRecord.verification_uri) ||
        undefined;
      const instructions =
        (typeof dataRecord.instructions === 'string' && dataRecord.instructions) ||
        (typeof dataRecord.message === 'string' && dataRecord.message) ||
        undefined;
      const userCode =
        (typeof dataRecord.user_code === 'string' && dataRecord.user_code) ||
        (typeof dataRecord.code === 'string' && dataRecord.code) ||
        (typeof dataRecord.userCode === 'string' && dataRecord.userCode) ||
        undefined;

      if (!urlCandidate && !instructions && !userCode) {
        throw new Error('No OAuth details returned');
      }

      const detailsKey = `${providerId}:${methodIndex}`;
      setOauthDetails((prev) => ({
        ...prev,
        [detailsKey]: {
          url: urlCandidate,
          instructions,
          userCode,
        },
      }));

      if (urlCandidate) {
        window.open(urlCandidate, '_blank', 'noopener,noreferrer');
      }
      setPendingOAuth({ providerId, methodIndex });
      toast.message(t('settings:providers.oauth.completeInBrowser'));
    } catch (error) {
      console.error('Failed to start OAuth flow:', error);
      toast.error(t('settings:providers.oauth.startFailed'));
    } finally {
      setAuthBusyKey(null);
    }
  };

  const handleOAuthComplete = async (providerId: string, methodIndex: number) => {
    const codeKey = `${providerId}:${methodIndex}`;
    const code = oauthCodes[codeKey]?.trim();

    const busyKey = `oauth-complete:${providerId}:${methodIndex}`;
    setAuthBusyKey(busyKey);

    try {
      const requestBody: { method: number; code?: string } = { method: methodIndex };
      if (code) {
        requestBody.code = code;
      }

      const response = await fetch(`/api/provider/${encodeURIComponent(providerId)}/oauth/callback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      const responsePayload = await response.json().catch(() => null);
      if (!response.ok) {
        const message = responsePayload?.error || 'Failed to complete OAuth flow';
        throw new Error(message);
      }

      toast.success(t('settings:providers.oauth.success'));
      setOauthCodes((prev) => ({ ...prev, [codeKey]: '' }));
      setPendingOAuth(null);
      await reloadOpenCodeConfiguration();
      await loadProviders();
      setSelectedProvider(providerId);
    } catch (error) {
      console.error('Failed to complete OAuth flow:', error);
      toast.error(t('settings:providers.oauth.completeFailed'));
    } finally {
      setAuthBusyKey(null);
    }
  };

  const handleCopyOAuthLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t('settings:providers.oauth.linkCopied'));
    } catch (error) {
      console.error('Failed to copy OAuth link:', error);
      toast.error(t('settings:providers.oauth.copyLinkFailed'));
    }
  };

  const handleCopyOAuthCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success(t('settings:providers.oauth.codeCopied'));
    } catch (error) {
      console.error('Failed to copy device code:', error);
      toast.error(t('settings:providers.oauth.copyCodeFailed'));
    }
  };

  const handleDisconnectProvider = async (providerId: string) => {
    const busyKey = `disconnect:${providerId}`;
    setAuthBusyKey(busyKey);

    try {
      const response = await fetch(`/api/provider/${encodeURIComponent(providerId)}/auth`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message = payload?.error || 'Failed to disconnect provider';
        throw new Error(message);
      }

      toast.success(t('settings:providers.disconnect.success'));
      await reloadOpenCodeConfiguration();
      await loadProviders();
    } catch (error) {
      console.error('Failed to disconnect provider:', error);
      toast.error(t('settings:providers.disconnectFailed'));
    } finally {
      setAuthBusyKey(null);
    }
  };

  const isAddMode = selectedProviderId === ADD_PROVIDER_ID;

  if (!isAddMode && providers.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center text-muted-foreground">
          <RiStackLine className="mx-auto mb-3 h-12 w-12 opacity-50" />
          <p className="typography-body">{t('settings:providers.noProviders')}</p>
          <p className="typography-meta mt-1 opacity-75">{t('settings:providers.noProvidersHint')}</p>
        </div>
      </div>
    );
  }

  if (isAddMode) {
    return (
      <ScrollableOverlay outerClassName="h-full" className="mx-auto max-w-3xl space-y-6 p-6">
        <div className="space-y-1">
          <h1 className="typography-ui-header font-semibold text-lg">{t('settings:providers.connect')}</h1>
          <p className="typography-body text-muted-foreground">
            {t('settings:providers.connectDescription')}
          </p>
        </div>

        <div className="space-y-4">
          <div className="space-y-1">
            <h2 className="typography-ui-header font-semibold text-foreground">{t('common:label.provider')}</h2>
            <p className="typography-meta text-muted-foreground/80">
              {t('settings:providers.selectProvider')}
            </p>
          </div>

          {availableLoading ? (
            <p className="typography-meta text-muted-foreground">{t('settings:providers.loading')}</p>
          ) : availableError ? (
            <p className="typography-meta text-muted-foreground">{availableError}</p>
          ) : unconnectedProviders.length === 0 ? (
            <p className="typography-meta text-muted-foreground">{t('settings:providers.allConnected')}</p>
          ) : (
            <DropdownMenu open={providerDropdownOpen} onOpenChange={(open) => {
              setProviderDropdownOpen(open);
              if (!open) setProviderSearchQuery('');
            }}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "flex w-fit items-center justify-between gap-2 rounded-lg border border-input bg-transparent px-3 py-2 typography-ui-label",
                    "hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  )}
                >
                  <span className={candidateProviderId ? "text-foreground" : "text-muted-foreground"}>
                    {candidateProviderId
                      ? (unconnectedProviders.find(p => p.id === candidateProviderId)?.name || candidateProviderId)
                      : t('settings:providers.selectProvider')}
                  </span>
                  <RiArrowDownSLine className="h-4 w-4 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="min-w-[200px] p-0"
                onCloseAutoFocus={(e) => e.preventDefault()}
              >
                <div
                  className="flex items-center gap-2 border-b px-3 py-2"
                  onKeyDown={(e) => e.stopPropagation()}
                >
                  <RiSearchLine className="h-4 w-4 text-muted-foreground" />
                  <input
                    type="text"
                    value={providerSearchQuery}
                    onChange={(e) => setProviderSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.stopPropagation()}
                    placeholder={t('settings:providers.searchPlaceholder')}
                    className="flex-1 bg-transparent typography-meta outline-none placeholder:text-muted-foreground"
                    autoFocus
                  />
                </div>
                <ScrollableOverlay outerClassName="max-h-[240px]" className="p-1">
                  {(() => {
                    const filtered = unconnectedProviders.filter(p => {
                      const query = providerSearchQuery.toLowerCase();
                      return (p.name || p.id).toLowerCase().includes(query) || p.id.toLowerCase().includes(query);
                    });
                    if (filtered.length === 0) {
                      return <p className="py-4 text-center typography-meta text-muted-foreground">{t('settings:providers.noProvidersFound')}</p>;
                    }
                    return filtered.map((provider) => (
                      <DropdownMenuItem
                        key={provider.id}
                        onSelect={() => {
                          setCandidateProviderId(provider.id);
                          setProviderDropdownOpen(false);
                          setProviderSearchQuery('');
                        }}
                        className="flex items-center justify-between"
                      >
                        <span>{provider.name || provider.id}</span>
                        {candidateProviderId === provider.id && (
                          <RiCheckLine className="h-4 w-4 text-primary" />
                        )}
                      </DropdownMenuItem>
                    ));
                  })()}
                </ScrollableOverlay>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {candidateProviderId && (
          <div className="space-y-4">
            <h2 className="typography-ui-header font-semibold text-foreground">{t('settings:providers.authentication')}</h2>

            {authLoading ? (
              <p className="typography-meta text-muted-foreground">{t('settings:providers.loadingAuth')}</p>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="typography-ui-label font-medium text-foreground">{t('settings:providers.apiKey')}</label>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Input
                      type="password"
                      value={apiKeyInputs[candidateProviderId] ?? ''}
                      onChange={(event) =>
                        setApiKeyInputs((prev) => ({
                          ...prev,
                          [candidateProviderId]: event.target.value,
                        }))
                      }
                      placeholder={t('settings:providers.apiKeyPlaceholder')}
                    />
                    <Button
                      size="sm"
                      onClick={() => handleSaveApiKey(candidateProviderId)}
                      disabled={authBusyKey === `api:${candidateProviderId}`}
                      className="h-8"
                    >
                      {authBusyKey === `api:${candidateProviderId}` ? t('common:button.saving') : t('settings:providers.saveKey')}
                    </Button>
                  </div>
                  <p className="typography-meta text-muted-foreground">
                    {t('settings:providers.apiKeyHint')}
                  </p>
                </div>

                {(() => {
                  const candidateAuthMethods = authMethodsByProvider[candidateProviderId] ?? [];
                  const candidateOAuthMethods = candidateAuthMethods.filter(
                    (method) => normalizeAuthType(method) === 'oauth'
                  );

                  if (candidateOAuthMethods.length === 0) {
                    return null;
                  }

                  return (
                    <div className="space-y-3">
                      {candidateOAuthMethods.map((method, index) => {
                        const methodLabel = method.label || method.name || `OAuth method ${index + 1}`;
                        const codeKey = `${candidateProviderId}:${index}`;
                        const isPending =
                          pendingOAuth?.providerId === candidateProviderId && pendingOAuth?.methodIndex === index;

                        return (
                          <div key={`${candidateProviderId}-${methodLabel}`} className="space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <div>
                                <div className="typography-ui-label font-medium text-foreground">{methodLabel}</div>
                                {(method.description || method.help) && (
                                  <div className="typography-meta text-muted-foreground">
                                    {String(method.description || method.help)}
                                  </div>
                                )}
                              </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleOAuthStart(candidateProviderId, index)}
                          disabled={authBusyKey === `oauth:${candidateProviderId}:${index}`}
                          className="h-8"
                        >
                          {t('settings:providers.oauth.connect')}
                        </Button>
                            </div>

                            {oauthDetails[codeKey]?.instructions && (
                              <p className="typography-meta text-muted-foreground">
                                {oauthDetails[codeKey]?.instructions}
                              </p>
                            )}

                            {oauthDetails[codeKey]?.userCode && (
                              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                                <Input value={oauthDetails[codeKey]?.userCode} readOnly />
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleCopyOAuthCode(oauthDetails[codeKey]?.userCode ?? '')}
                                  className="h-8"
                                >
                                  {t('settings:providers.oauth.copyCode')}
                                </Button>
                              </div>
                            )}

                            {oauthDetails[codeKey]?.url && (
                              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                                <Input value={oauthDetails[codeKey]?.url} readOnly />
                                <div className="flex gap-2">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-8"
                                    asChild
                                  >
                                    <a href={oauthDetails[codeKey]?.url} target="_blank" rel="noopener noreferrer">
                                      {t('settings:providers.oauth.openLink')}
                                    </a>
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleCopyOAuthLink(oauthDetails[codeKey]?.url ?? '')}
                                    className="h-8"
                                  >
                                    {t('settings:providers.oauth.copyLink')}
                                  </Button>
                                </div>
                              </div>
                            )}

                            {isPending && (
                              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                                <Input
                                  value={oauthCodes[codeKey] ?? ''}
                                  onChange={(event) =>
                                    setOauthCodes((prev) => ({
                                      ...prev,
                                      [codeKey]: event.target.value,
                                    }))
                                  }
                                  placeholder={t('settings:providers.oauth.authCodePlaceholder')}
                                />
                                <Button
                                  size="sm"
                                  onClick={() => handleOAuthComplete(candidateProviderId, index)}
                                  disabled={authBusyKey === `oauth-complete:${candidateProviderId}:${index}`}
                                  className="h-8"
                                >
                                  {authBusyKey === `oauth-complete:${candidateProviderId}:${index}`
                                    ? t('common:button.saving')
                                    : t('settings:providers.oauth.complete')}
                                </Button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        )}
      </ScrollableOverlay>
    );
  }

  if (!selectedProvider) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center text-muted-foreground">
          <RiStackLine className="mx-auto mb-3 h-12 w-12 opacity-50" />
          <p className="typography-body">{t('settings:providers.selectFromSidebar')}</p>
          <p className="typography-meta mt-1 opacity-75">{t('settings:providers.reviewDetails')}</p>
        </div>
      </div>
    );
  }

  const providerModels = Array.isArray(selectedProvider.models) ? selectedProvider.models : [];

  const providerAuthMethods = authMethodsByProvider[selectedProvider.id] ?? [];
  const oauthAuthMethods = providerAuthMethods.filter((method) => normalizeAuthType(method) === 'oauth');

  const filteredModels = providerModels.filter((model) => {
    const name = typeof model?.name === 'string' ? model.name : '';
    const id = typeof model?.id === 'string' ? model.id : '';
    const query = modelQuery.trim().toLowerCase();
    if (!query) return true;
    return name.toLowerCase().includes(query) || id.toLowerCase().includes(query);
  });

  return (
    <ScrollableOverlay outerClassName="h-full" className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <ProviderLogo providerId={selectedProvider.id} className="h-5 w-5" />
          <h1 className="typography-ui-header font-semibold text-lg">
            {selectedProvider.name || selectedProvider.id}
          </h1>
        </div>
        <p className="typography-body text-muted-foreground">
          {t('settings:providers.providerId')} {selectedProvider.id}
        </p>
      </div>

      <div className="space-y-4">
        <h2 className="typography-ui-header font-semibold text-foreground">{t('settings:providers.authentication')}</h2>

        {authLoading ? (
          <p className="typography-meta text-muted-foreground">{t('settings:providers.loadingAuth')}</p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="typography-ui-label font-medium text-foreground">{t('settings:providers.apiKey')}</label>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                  type="password"
                  value={apiKeyInputs[selectedProvider.id] ?? ''}
                  onChange={(event) =>
                    setApiKeyInputs((prev) => ({
                      ...prev,
                      [selectedProvider.id]: event.target.value,
                    }))
                  }
                  placeholder={t('settings:providers.apiKeyPlaceholder')}
                />
                <Button
                  size="sm"
                  onClick={() => handleSaveApiKey(selectedProvider.id)}
                  disabled={authBusyKey === `api:${selectedProvider.id}`}
                  className="h-8"
                >
                  {authBusyKey === `api:${selectedProvider.id}` ? t('common:button.saving') : t('settings:providers.saveKey')}
                </Button>
              </div>
              <p className="typography-meta text-muted-foreground">
                {t('settings:providers.apiKeyHint')}
              </p>
            </div>

            <div className="pt-2 border-t border-border/40">
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleDisconnectProvider(selectedProvider.id)}
                disabled={authBusyKey === `disconnect:${selectedProvider.id}`}
                className="h-8 text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                {authBusyKey === `disconnect:${selectedProvider.id}` ? t('common:button.disconnecting') : t('settings:providers.disconnect.button')}
              </Button>
            </div>

            {oauthAuthMethods.length > 0 && (
              <div className="space-y-3">
                {oauthAuthMethods.map((method, index) => {
                  const methodLabel = method.label || method.name || `OAuth method ${index + 1}`;
                  const codeKey = `${selectedProvider.id}:${index}`;
                  const isPending =
                    pendingOAuth?.providerId === selectedProvider.id && pendingOAuth?.methodIndex === index;

                  return (
                    <div key={`${selectedProvider.id}-${methodLabel}`} className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="typography-ui-label font-medium text-foreground">{methodLabel}</div>
                          {(method.description || method.help) && (
                            <div className="typography-meta text-muted-foreground">
                              {String(method.description || method.help)}
                            </div>
                          )}
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleOAuthStart(selectedProvider.id, index)}
                          disabled={authBusyKey === `oauth:${selectedProvider.id}:${index}`}
                          className="h-8"
                        >
                          {t('settings:providers.oauth.connect')}
                        </Button>
                      </div>

                      {oauthDetails[codeKey]?.instructions && (
                        <p className="typography-meta text-muted-foreground">
                          {oauthDetails[codeKey]?.instructions}
                        </p>
                      )}

                      {oauthDetails[codeKey]?.userCode && (
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                          <Input value={oauthDetails[codeKey]?.userCode} readOnly />
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleCopyOAuthCode(oauthDetails[codeKey]?.userCode ?? '')}
                            className="h-8"
                          >
                            {t('settings:providers.oauth.copyCode')}
                          </Button>
                        </div>
                      )}

                      {oauthDetails[codeKey]?.url && (
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                          <Input value={oauthDetails[codeKey]?.url} readOnly />
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8"
                              asChild
                            >
                              <a href={oauthDetails[codeKey]?.url} target="_blank" rel="noopener noreferrer">
                                {t('settings:providers.oauth.openLink')}
                              </a>
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleCopyOAuthLink(oauthDetails[codeKey]?.url ?? '')}
                              className="h-8"
                            >
                              {t('settings:providers.oauth.copyLink')}
                            </Button>
                          </div>
                        </div>
                      )}


                      {isPending && (
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                          <Input
                            value={oauthCodes[codeKey] ?? ''}
                            onChange={(event) =>
                              setOauthCodes((prev) => ({
                                ...prev,
                                [codeKey]: event.target.value,
                              }))
                            }
                            placeholder={t('settings:providers.oauth.authCodePlaceholder')}
                          />
                          <Button
                            size="sm"
                            onClick={() => handleOAuthComplete(selectedProvider.id, index)}
                            disabled={authBusyKey === `oauth-complete:${selectedProvider.id}:${index}`}
                            className="h-8"
                          >
                            {authBusyKey === `oauth-complete:${selectedProvider.id}:${index}`
                              ? t('common:button.saving')
                              : t('settings:providers.oauth.complete')}
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}


          </div>
        )}
      </div>

      <div className="space-y-4">
        <div className="space-y-1">
          <h2 className="typography-ui-header font-semibold text-foreground">{t('settings:providers.models')}</h2>
          <p className="typography-meta text-muted-foreground/80">
            {t('settings:providers.modelsDescription')}
          </p>
        </div>

        <Input
          value={modelQuery}
          onChange={(event) => setModelQuery(event.target.value)}
          placeholder={t('settings:providers.modelsFilterPlaceholder')}
        />

        <div className="border-t border-border/40">
          {filteredModels.length === 0 ? (
            <p className="typography-meta text-muted-foreground py-3 px-2">{t('settings:providers.noModelsFound')}</p>
          ) : (
            filteredModels.map((model) => {
              const modelId = typeof model?.id === 'string' ? model.id : '';
              const modelName = typeof model?.name === 'string' ? model.name : modelId;
              const metadata = modelId ? getModelMetadata(selectedProvider.id, modelId) as ModelMetadata | undefined : undefined;

              const contextTokens = formatTokens(metadata?.limit?.context);
              const outputTokens = formatTokens(metadata?.limit?.output);

              const capabilityIcons: Array<{ key: string; icon: typeof RiToolsLine; label: string }> = [];
              if (metadata?.tool_call) capabilityIcons.push({ key: 'tools', icon: RiToolsLine, label: t('settings:providers.capabilities.toolCalling') });
              if (metadata?.reasoning) capabilityIcons.push({ key: 'reasoning', icon: RiBrainAi3Line, label: t('settings:providers.capabilities.reasoning') });
              if (metadata?.attachment) capabilityIcons.push({ key: 'image', icon: RiFileImageLine, label: t('settings:providers.capabilities.imageInput') });

              return (
                <div
                  key={modelId}
                  className="flex items-center gap-2 px-2 py-1.5 border-b border-border/40"
                >
                  <span className="typography-meta font-medium text-foreground truncate flex-1 min-w-0">
                    {modelName}
                  </span>
                  {(contextTokens || outputTokens) && (
                    <span className="typography-micro text-muted-foreground flex-shrink-0">
                      {contextTokens ? `${contextTokens} ctx` : ''}
                      {contextTokens && outputTokens ? ' · ' : ''}
                      {outputTokens ? `${outputTokens} out` : ''}
                    </span>
                  )}
                  {capabilityIcons.length > 0 && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {capabilityIcons.map(({ key, icon: Icon, label }) => (
                        <span
                          key={key}
                          className="flex h-4 w-4 items-center justify-center text-muted-foreground"
                          title={label}
                          aria-label={label}
                        >
                          <Icon className="h-3 w-3" />
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </ScrollableOverlay>
  );
};
