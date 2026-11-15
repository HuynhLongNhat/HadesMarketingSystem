
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronsUpDown,
  CircleAlert,
  Loader2,
} from "lucide-react";

import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@workspace/ui/components/command";

import {
  aiProvidersApi,
  type AiProviderType,
  type CatalogModel,
} from "@/lib/ai-providers-api";
import { useUiLanguage } from "@/lib/ui-language";

interface Props {
  provider?: AiProviderType;
  /** Required by Groq so the backend can use this organization's credential. */
  connectionId?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  embeddingOnly?: boolean;
}

export function ModelPicker({
  provider,
  connectionId,
  value,
  onChange,
  disabled,
  embeddingOnly = false,
}: Props) {
  const { t } = useUiLanguage();

  const [models, setModels] = useState<CatalogModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const [checking, setChecking] = useState(false);
  const [availability, setAvailability] = useState<string | null>(null);

  useEffect(() => {
    if (!provider) {
      setModels([]);
      setError(null);
      setLoading(false);
      return;
    }

    let alive = true;

    setLoading(true);
    setError(null);
    setModels([]);
    setAvailability(null);

    const loadModels = embeddingOnly
      ? aiProvidersApi.listEmbeddingModels(provider)
      : aiProvidersApi.listCatalogModels(provider, connectionId);

    void loadModels
      .then((items) => {
        if (alive) setModels(items);
      })
      .catch((loadError: unknown) => {
        if (alive) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Không thể tải danh sách mô hình.",
          );
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [connectionId, embeddingOnly, provider, revision]);

  const selected = useMemo(
    () => models.find((item) => item.id === value),
    [models, value],
  );

  const label = !provider
    ? t.chooseConnection
    : loading
      ? t.loadingModels
      : error
        ? "Không thể tải danh sách mô hình"
        : selected
          ? selected.name
          : value
            ? value
            : models.length === 0
              ? t.noModelsAvailable
              : t.chooseModel;

  return (
    <div className="min-w-0 space-y-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={
              disabled ||
              !provider ||
              loading ||
              Boolean(error) ||
              models.length === 0
            }
            className="w-full min-w-0 justify-between font-normal text-foreground"
          >
            <span className="min-w-0 truncate text-left">
              {label}
            </span>

            {loading ? (
              <Loader2 className="size-4 shrink-0 animate-spin" />
            ) : (
              <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
            )}
          </Button>
        </PopoverTrigger>

        <PopoverContent
          align="start"
          sideOffset={4}
          className="w-[var(--radix-popover-trigger-width)] p-0"
        >
          <Command
            filter={(itemValue, search) =>
              itemValue.toLowerCase().includes(search.toLowerCase())
                ? 1
                : 0
            }
          >
            <CommandInput placeholder={t.searchModel} />

            <CommandList className="max-h-72">
              <CommandEmpty>{t.noModel}</CommandEmpty>

              {models.map((model) => (
                <CommandItem
                  key={model.id}
                  value={`${model.name} ${model.id}`}
                  onSelect={() => {
                    onChange(model.id);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={`size-4 shrink-0 ${
                      value === model.id
                        ? "opacity-100"
                        : "opacity-0"
                    }`}
                  />

                  <span className="min-w-0">
                    <span className="block truncate">
                      {model.name}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {model.id}
                      {model.dimensions
                        ? ` · ${model.dimensions} dimensions`
                        : ""}
                    </span>
                  </span>
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {provider && !loading && !error && (
        <p className="text-xs text-muted-foreground">
          {models.length} {t.modelCount}
          {embeddingOnly ? " embedding tương thích" : ""}
        </p>
      )}

      {value && !loading && !error && !selected && (
        <p className="text-xs text-muted-foreground">
          {t.currentModel}: {value}
        </p>
      )}

      {!embeddingOnly && provider && !loading && (error || models.length === 0) && (
        <div className="space-y-2 rounded-md border border-dashed p-3">
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" />
            <span>
              {error
                ? `${error} Bạn vẫn có thể nhập Model ID thủ công.`
                : "Catalog không có mô hình khả dụng. Bạn vẫn có thể nhập Model ID thủ công."}
            </span>
          </p>

          <Input
            value={value}
            disabled={disabled}
            maxLength={200}
            placeholder="Ví dụ: llama-3.3-70b-versatile"
            onChange={(event) => {
              setAvailability(null);
              onChange(event.target.value);
            }}
            aria-label="Model ID thủ công"
          />

          <div className="flex flex-wrap gap-2">
            {error && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={disabled || loading}
                onClick={() => setRevision((n) => n + 1)}
              >
                {t.retry}
              </Button>
            )}

          </div>
        </div>
      )}

      {!embeddingOnly && provider === "groq" && connectionId && value.trim() && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled || checking}
            onClick={() => {
              setChecking(true);
              setAvailability(null);
              void aiProvidersApi.validateModel(connectionId, value.trim())
                .then((result) => setAvailability(result.message))
                .catch((checkError: unknown) => {
                  setAvailability(
                    checkError instanceof Error
                      ? checkError.message
                      : "Không thể kiểm tra Model ID.",
                  );
                })
                .finally(() => setChecking(false));
            }}
          >
            {checking && <Loader2 className="mr-1 size-3.5 animate-spin" />}
            Kiểm tra Model ID
          </Button>

          {availability && (
            <p className="text-xs text-muted-foreground" role="status">
              {availability}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
