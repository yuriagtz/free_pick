import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { Calendar, Check, Copy, Loader2, LogIn, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export default function AvailabilityChecker() {
  const { user, isAuthenticated } = useAuth();
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [workingHoursStart, setWorkingHoursStart] = useState(9);
  const [workingHoursEnd, setWorkingHoursEnd] = useState(18);
  const [slotDuration, setSlotDuration] = useState(30);

  const { data: connectionStatus, isLoading: statusLoading, refetch: refetchStatus } = 
    trpc.calendar.getConnectionStatus.useQuery(undefined, {
      enabled: isAuthenticated,
    });

  const { data: authUrl } = trpc.calendar.getAuthUrl.useQuery(undefined, {
    enabled: isAuthenticated && !connectionStatus?.connected,
  });

  const disconnectMutation = trpc.calendar.disconnect.useMutation({
    onSuccess: () => {
      toast.success("Googleカレンダーの連携を解除しました");
      refetchStatus();
    },
    onError: (error) => {
      toast.error(`連携解除に失敗しました: ${error.message}`);
    },
  });

  const { data: availabilityData, isLoading: slotsLoading, refetch: refetchSlots } = 
    trpc.calendar.getAvailableSlots.useQuery(
      {
        startDate,
        endDate,
        workingHoursStart,
        workingHoursEnd,
        slotDurationMinutes: slotDuration,
      },
      {
        enabled: false,
      }
    );

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const googleConnected = urlParams.get("google_connected");
    const error = urlParams.get("error");

    if (googleConnected === "true") {
      toast.success("Googleカレンダーと連携しました");
      refetchStatus();
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (error) {
      toast.error(`連携に失敗しました: ${error}`);
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  useEffect(() => {
    const today = new Date();
    const nextWeek = new Date();
    nextWeek.setDate(today.getDate() + 7);

    setStartDate(today.toISOString().split("T")[0]);
    setEndDate(nextWeek.toISOString().split("T")[0]);
  }, []);

  const handleCheckAvailability = () => {
    if (!startDate || !endDate) {
      toast.error("開始日と終了日を入力してください");
      return;
    }

    if (new Date(startDate) > new Date(endDate)) {
      toast.error("開始日は終了日より前である必要があります");
      return;
    }

    refetchSlots();
  };

  const handleCopyText = () => {
    if (availabilityData?.formattedText) {
      navigator.clipboard.writeText(availabilityData.formattedText);
      toast.success("テキストをコピーしました");
    }
  };

  const handleDisconnect = () => {
    if (confirm("Googleカレンダーの連携を解除しますか?")) {
      disconnectMutation.mutate();
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>ログインが必要です</CardTitle>
            <CardDescription>
              空き時間を確認するにはログインしてください
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={() => window.location.href = getLoginUrl()}
              className="w-full"
            >
              <LogIn className="mr-2 h-4 w-4" />
              ログイン
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (statusLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-8 px-4">
      <div className="container max-w-4xl">
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">空き時間抽出</h1>
          <p className="text-gray-600">Googleカレンダーから空き時間を自動抽出します</p>
        </div>

        {!connectionStatus?.connected ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Googleカレンダー連携
              </CardTitle>
              <CardDescription>
                カレンダーと連携して空き時間を確認しましょう
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                onClick={() => authUrl && (window.location.href = authUrl.url)}
                disabled={!authUrl}
                className="w-full"
              >
                <Calendar className="mr-2 h-4 w-4" />
                Googleカレンダーと連携
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Check className="h-5 w-5 text-green-600" />
                      連携済み
                    </CardTitle>
                    <CardDescription>
                      Googleカレンダーと連携されています
                    </CardDescription>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDisconnect}
                    disabled={disconnectMutation.isPending}
                  >
                    <X className="mr-2 h-4 w-4" />
                    連携解除
                  </Button>
                </div>
              </CardHeader>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>期間と条件を設定</CardTitle>
                <CardDescription>
                  空き時間を確認したい期間と条件を入力してください
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="startDate">開始日</Label>
                    <Input
                      id="startDate"
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="endDate">終了日</Label>
                    <Input
                      id="endDate"
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="workingHoursStart">開始時刻</Label>
                    <Input
                      id="workingHoursStart"
                      type="number"
                      min="0"
                      max="23"
                      value={workingHoursStart}
                      onChange={(e) => setWorkingHoursStart(Number(e.target.value))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="workingHoursEnd">終了時刻</Label>
                    <Input
                      id="workingHoursEnd"
                      type="number"
                      min="0"
                      max="23"
                      value={workingHoursEnd}
                      onChange={(e) => setWorkingHoursEnd(Number(e.target.value))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="slotDuration">枠の長さ(分)</Label>
                    <Input
                      id="slotDuration"
                      type="number"
                      min="15"
                      max="240"
                      step="15"
                      value={slotDuration}
                      onChange={(e) => setSlotDuration(Number(e.target.value))}
                    />
                  </div>
                </div>

                <Button
                  onClick={handleCheckAvailability}
                  disabled={slotsLoading}
                  className="w-full"
                >
                  {slotsLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      確認中...
                    </>
                  ) : (
                    <>
                      <Calendar className="mr-2 h-4 w-4" />
                      空き時間を確認
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>

            {availabilityData && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>空き時間一覧</CardTitle>
                      <CardDescription>
                        {availabilityData.totalSlots}件の空き枠が見つかりました
                        {availabilityData.debug && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            (取得イベント数: {availabilityData.debug.eventCount}件)
                          </span>
                        )}
                      </CardDescription>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleCopyText}
                    >
                      <Copy className="mr-2 h-4 w-4" />
                      コピー
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {availabilityData.debug && availabilityData.debug.apiError && (
                    <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md">
                      <h3 className="font-semibold mb-2 text-red-700">エラー: APIリクエスト失敗</h3>
                      <p className="text-sm text-red-600">{availabilityData.debug.apiError}</p>
                    </div>
                  )}
                  {availabilityData.debug && availabilityData.debug.eventCount > 0 && (
                    <div className="mb-4 p-4 bg-muted rounded-md">
                      <h3 className="font-semibold mb-2">デバッグ: 取得したイベント</h3>
                      <pre className="text-xs overflow-auto max-h-40">
                        {JSON.stringify(availabilityData.debug.events, null, 2)}
                      </pre>
                    </div>
                  )}
                  {availabilityData.debug && availabilityData.debug.eventCount === 0 && !availabilityData.debug.apiError && (
                    <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-md">
                      <p className="text-sm text-yellow-700">警告: Googleカレンダーからイベントが取得できませんでした。指定期間に予定があるか確認してください。</p>
                    </div>
                  )}
                  <Textarea
                    value={availabilityData.formattedText}
                    readOnly
                    className="min-h-[400px] font-mono text-sm"
                  />
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
