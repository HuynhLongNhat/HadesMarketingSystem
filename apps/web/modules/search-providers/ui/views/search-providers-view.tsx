"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@workspace/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog";
import {
  searchProvidersApi,
  type SearchConnectionTestResult,
  type SearchProviderConnection,
  type SearchProviderType,
} from "@/lib/search-providers-api";

const providerLabels: Record<SearchProviderType, string> = {
  searxng: "SearXNG nội bộ",
  tavily: "Tavily",
  brave: "Brave Search",
};
const needsKey = (provider: SearchProviderType) => provider !== "searxng";

export function SearchProvidersView({
  embedded = false,
}: {
  embedded?: boolean;
}) {
  const [connections, setConnections] = useState<SearchProviderConnection[]>(
    [],
  );
  const [provider, setProvider] = useState<SearchProviderType>("searxng");
  const [name, setName] = useState("SearXNG chính");
  const [priority, setPriority] = useState("10");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<
    Record<string, SearchConnectionTestResult>
  >({});
  const [replaceTarget, setReplaceTarget] =
    useState<SearchProviderConnection | null>(null);
  const [replacementKey, setReplacementKey] = useState("");
  const [deleteTarget, setDeleteTarget] =
    useState<SearchProviderConnection | null>(null);
  const load = useCallback(async () => {
    try {
      setConnections(await searchProvidersApi.list());
    } catch {
      toast.error("Không thể tải Search Providers.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  function changeProvider(value: SearchProviderType) {
    setProvider(value);
    setApiKey("");
    setName(
      value === "searxng"
        ? "SearXNG chính"
        : value === "tavily"
          ? "Tavily"
          : "Brave Search",
    );
  }
  async function create(event: React.FormEvent) {
    event.preventDefault();
    const numericPriority = Number(priority);
    if (
      !Number.isInteger(numericPriority) ||
      numericPriority < 1 ||
      numericPriority > 1000
    )
      return toast.error("Độ ưu tiên phải từ 1 đến 1000.");
    if (needsKey(provider) && !apiKey.trim())
      return toast.error("Hãy nhập API key cho provider này.");
    setBusy("create");
    try {
      await searchProvidersApi.create({
        provider,
        name,
        priority: numericPriority,
        ...(needsKey(provider) ? { apiKey } : {}),
      });
      setApiKey("");
      toast.success(`Đã lưu ${providerLabels[provider]}.`);
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Không thể lưu cấu hình.",
      );
    } finally {
      setBusy(null);
    }
  }
  async function test(id: string) {
    setBusy(id);
    try {
      const value = await searchProvidersApi.test(id);
      setResult((current) => ({ ...current, [id]: value }));
      value.success
        ? toast.success("Kết nối thành công.")
        : toast.error(value.message);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Không thể kiểm tra kết nối.",
      );
    } finally {
      setBusy(null);
    }
  }
  async function toggle(connection: SearchProviderConnection) {
    setBusy(connection.id);
    try {
      await searchProvidersApi.update(connection.id, {
        enabled: !connection.enabled,
      });
      await load();
    } catch {
      toast.error("Không thể cập nhật trạng thái.");
    } finally {
      setBusy(null);
    }
  }
  async function savePriority(
    connection: SearchProviderConnection,
    value: string,
  ) {
    const priority = Number(value);
    if (!Number.isInteger(priority) || priority < 1 || priority > 1000)
      return toast.error("Độ ưu tiên phải từ 1 đến 1000.");
    setBusy(connection.id);
    try {
      await searchProvidersApi.update(connection.id, { priority });
      await load();
    } catch {
      toast.error("Không thể cập nhật độ ưu tiên.");
    } finally {
      setBusy(null);
    }
  }
  async function replace() {
    if (!replaceTarget || !replacementKey.trim()) return;
    setBusy(replaceTarget.id);
    try {
      await searchProvidersApi.update(replaceTarget.id, {
        apiKey: replacementKey,
      });
      toast.success("Đã thay API key.");
      setReplacementKey("");
      setReplaceTarget(null);
      await load();
    } catch {
      toast.error("Không thể thay API key.");
    } finally {
      setBusy(null);
    }
  }
  async function remove() {
    if (!deleteTarget) return;
    setBusy(deleteTarget.id);
    try {
      await searchProvidersApi.remove(deleteTarget.id);
      toast.success("Đã xóa cấu hình.");
      setDeleteTarget(null);
      await load();
    } catch {
      toast.error("Không thể xóa cấu hình.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      {!embedded && (
        <div>
          <h1 className="text-2xl font-semibold">Công cụ tìm kiếm</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            SearXNG được ưu tiên theo thứ tự cấu hình. API key Tavily/Brave luôn
            được mã hóa và không hiển thị lại.
          </p>
        </div>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Thêm Search Provider</CardTitle>
          <CardDescription>
            Ưu tiên nhỏ hơn sẽ chạy trước. Fallback chỉ dùng provider kế tiếp
            khi provider trước lỗi hoặc không có kết quả phù hợp.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(event) => void create(event)}
            className="grid gap-4 sm:grid-cols-2"
          >
            <div className="space-y-2">
              <Label htmlFor="search-provider">Provider</Label>
              <select
                id="search-provider"
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={provider}
                onChange={(event) =>
                  changeProvider(event.target.value as SearchProviderType)
                }
              >
                <option value="searxng">
                  SearXNG nội bộ — không cần API key
                </option>
                <option value="tavily">Tavily — cần API key</option>
                <option value="brave">Brave Search — cần API key</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="provider-name">Tên kết nối</Label>
              <Input
                id="provider-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={100}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="provider-priority">Độ ưu tiên</Label>
              <Input
                id="provider-priority"
                type="number"
                min="1"
                max="1000"
                value={priority}
                onChange={(event) => setPriority(event.target.value)}
                required
              />
            </div>
            {needsKey(provider) ? (
              <div className="space-y-2">
                <Label htmlFor="provider-key">API key</Label>
                <div className="flex gap-2">
                  <Input
                    id="provider-key"
                    type={showKey ? "text" : "password"}
                    autoComplete="new-password"
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    maxLength={4096}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => setShowKey(!showKey)}
                    aria-label="Hiện hoặc ẩn API key"
                  >
                    {showKey ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </Button>
                </div>
              </div>
            ) : (
              <p className="self-end text-sm text-muted-foreground">
                SearXNG chạy qua Research Service nội bộ, không lưu API key.
              </p>
            )}
            <div className="sm:col-span-2">
              <Button type="submit" disabled={busy !== null || !name.trim()}>
                {busy === "create" && (
                  <Loader2 className="size-4 animate-spin" />
                )}
                <KeyRound className="size-4" />
                Lưu cấu hình
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Thứ tự fallback</h2>
        {connections.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Chưa có Search Provider nào được cấu hình.
            </CardContent>
          </Card>
        ) : (
          connections.map((connection) => (
            <Card key={connection.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-4 py-5">
                <div>
                  <p className="font-medium">{connection.name}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {providerLabels[connection.provider]} ·{" "}
                    {connection.enabled ? "Đang bật" : "Đã tắt"} ·{" "}
                    {connection.hasApiKey
                      ? "API key đã lưu"
                      : "Không dùng API key"}
                  </p>
                  {connection.circuitOpenUntil &&
                    new Date(connection.circuitOpenUntil) > new Date() && (
                      <p className="mt-1 text-sm text-destructive">
                        Tạm dừng sau lỗi liên tiếp đến{" "}
                        {new Intl.DateTimeFormat("vi-VN", {
                          timeStyle: "short",
                        }).format(new Date(connection.circuitOpenUntil))}
                        .
                      </p>
                    )}
                  {result[connection.id]?.message && (
                    <p className="mt-2 text-sm text-muted-foreground">
                      {result[connection.id]?.message}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1">
                    <Label
                      className="sr-only"
                      htmlFor={`priority-${connection.id}`}
                    >
                      Độ ưu tiên
                    </Label>
                    <Input
                      id={`priority-${connection.id}`}
                      className="h-8 w-20"
                      type="number"
                      min="1"
                      max="1000"
                      defaultValue={connection.priority}
                      onBlur={(event) => {
                        if (
                          Number(event.currentTarget.value) !==
                          connection.priority
                        )
                          void savePriority(
                            connection,
                            event.currentTarget.value,
                          );
                      }}
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy !== null || !connection.enabled}
                    onClick={() => void test(connection.id)}
                  >
                    {busy === connection.id ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <RefreshCw className="size-4" />
                    )}
                    Kiểm tra
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() => void toggle(connection)}
                  >
                    {connection.enabled ? "Tắt" : "Bật"}
                  </Button>
                  {needsKey(connection.provider) && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy !== null}
                      onClick={() => setReplaceTarget(connection)}
                    >
                      <KeyRound className="size-4" />
                      Đổi khóa
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy !== null}
                    onClick={() => setDeleteTarget(connection)}
                    aria-label={`Xóa ${connection.name}`}
                  >
                    <Trash2 className="size-4" />
                    Xóa
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </section>
      <p className="text-xs text-muted-foreground">
        Kiểm tra kết nối chỉ chạy khi bạn chủ động nhấn nút. Tavily và Brave có
        thể tiêu thụ quota; hệ thống không xoay API key để vượt giới hạn nhà
        cung cấp.
      </p>
      <Dialog
        open={replaceTarget !== null}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setReplaceTarget(null);
            setReplacementKey("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Thay API key</DialogTitle>
            <DialogDescription>
              API key mới sẽ được mã hóa; khóa cũ không thể hiển thị lại.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="replacement-key">API key mới</Label>
            <Input
              id="replacement-key"
              type="password"
              autoComplete="new-password"
              value={replacementKey}
              onChange={(event) => setReplacementKey(event.target.value)}
              maxLength={4096}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setReplaceTarget(null)}
              disabled={busy !== null}
            >
              Hủy
            </Button>
            <Button
              onClick={() => void replace()}
              disabled={busy !== null || !replacementKey.trim()}
            >
              Lưu API key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xóa Search Provider?</AlertDialogTitle>
            <AlertDialogDescription>
              Bạn có chắc muốn xóa cấu hình {deleteTarget?.name}? Hành động này
              không thể hoàn tác.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy !== null}>Hủy</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void remove();
              }}
              disabled={busy !== null}
            >
              Xác nhận xóa
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
