import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { Calendar, Check, Copy, Loader2, LogIn, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export default function AvailabilityChecker() {
  // No authentication needed - Google tokens are in cookies
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [workingHoursStart, setWorkingHoursStart] = useState(9);
  const [workingHoursEnd, setWorkingHoursEnd] = useState(18);
  const [slotDuration, setSlotDuration] = useState(30);
  const [selectedCalendarIds, setSelectedCalendarIds] = useState<string[]>(['primary']);
  const [bufferBeforeMinutes, setBufferBeforeMinutes] = useState(0);
  const [bufferAfterMinutes, setBufferAfterMinutes] = useState(0);
  const [mergeSlots, setMergeSlots] = useState(false);
  const [excludedDays, setExcludedDays] = useState<number[]>([]);
  const [ignoreAllDayEvents, setIgnoreAllDayEvents] = useState(false);

  const { data: connectionStatus, isLoading: statusLoading, refetch: refetchStatus } = 
    trpc.calendar.getConnectionStatus.useQuery();

  const { data: authUrl, error: authUrlError } = trpc.calendar.getAuthUrl.useQuery(undefined, {
    enabled: !connectionStatus?.connected,
    retry: false,
  });

  const { data: calendarListData, isLoading: calendarsLoading } = 
    trpc.calendar.getCalendarList.useQuery(undefined, {
      enabled: connectionStatus?.connected,
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
        calendarIds: selectedCalendarIds,
        bufferBeforeMinutes,
        bufferAfterMinutes,
        mergeSlots,
        excludedDays,
        ignoreAllDayEvents,
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

  // Auto-select primary calendar when calendar list is loaded
  useEffect(() => {
    if (calendarListData && calendarListData.calendars.length > 0) {
      const primaryCalendar = calendarListData.calendars.find(cal => cal.primary);
      if (primaryCalendar && !selectedCalendarIds.includes(primaryCalendar.id)) {
        setSelectedCalendarIds([primaryCalendar.id]);
      }
    }
  }, [calendarListData]);

  const handleCheckAvailability = () => {
    if (!startDate || !endDate) {
      toast.error("開始日と終了日を入力してください");
      return;
    }

    if (selectedCalendarIds.length === 0) {
      toast.error("カレンダーを少なくとも1つ選択してください");
      return;
    }

    if (new Date(startDate) > new Date(endDate)) {
      toast.error("開始日は終了日より前である必要があります");
      return;
    }

    if (selectedCalendarIds.length === 0) {
      toast.error("少なくとも1つのカレンダーを選択してください");
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

  const handleCalendarToggle = (calendarId: string, checked: boolean) => {
    if (checked) {
      setSelectedCalendarIds([...selectedCalendarIds, calendarId]);
    } else {
      setSelectedCalendarIds(selectedCalendarIds.filter(id => id !== calendarId));
    }
  };

  // No authentication check needed

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
          <h1 className="text-4xl font-bold text-gray-900 mb-2">FreePick</h1>
          <p className="text-gray-600">Googleカレンダーから空き時間を自動抽出するサービスです</p>
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
              {authUrlError && (
                <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3">
                  ⚠️ 認証URLの取得に失敗しました。環境変数（GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, BASE_URL）が設定されているか確認してください。
                </div>
              )}
              <Button
                onClick={() => {
                  if (authUrl?.url) {
                    window.location.href = authUrl.url;
                  } else {
                    // Fallback: 直接リダイレクト
                    window.location.href = '/api/auth/google';
                  }
                }}
                disabled={false}
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

            {calendarsLoading ? (
              <Card>
                <CardContent className="py-8 flex justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
                </CardContent>
              </Card>
            ) : calendarListData && calendarListData.calendars.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>カレンダー選択</CardTitle>
                  <CardDescription>
                    空き時間を確認するカレンダーを選択してください
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {selectedCalendarIds.length === 0 && (
                    <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3 mb-3">
                      ⚠️ カレンダーを少なくとも1つ選択してください
                    </div>
                  )}
                  {calendarListData.calendars
                    .sort((a, b) => {
                      // Primary calendar first
                      if (a.primary && !b.primary) return -1;
                      if (!a.primary && b.primary) return 1;
                      return 0;
                    })
                    .map((calendar) => (
                    <div key={calendar.id} className="flex items-center space-x-2">
                      <Checkbox
                        id={calendar.id}
                        checked={selectedCalendarIds.includes(calendar.id)}
                        onCheckedChange={(checked) => handleCalendarToggle(calendar.id, checked as boolean)}
                      />
                      <label
                        htmlFor={calendar.id}
                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer flex items-center gap-2"
                      >
                        {calendar.backgroundColor && (
                          <div
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: calendar.backgroundColor }}
                          />
                        )}
                        {calendar.summary}
                        {calendar.primary && (
                          <span className="text-xs text-muted-foreground">(プライマリ)</span>
                        )}
                      </label>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

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
                      min={new Date().toISOString().split('T')[0]}
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
                    <Label htmlFor="slotDuration" className={mergeSlots ? "text-muted-foreground" : ""}>
                      枠の長さ(分)
                      {mergeSlots && <span className="text-xs ml-2">(連続表示時は無効)</span>}
                    </Label>
                    <Input
                      id="slotDuration"
                      type="number"
                      min="15"
                      max="240"
                      step="15"
                      value={slotDuration}
                      onChange={(e) => setSlotDuration(Number(e.target.value))}
                      disabled={mergeSlots}
                      className={mergeSlots ? "bg-muted" : ""}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>バッファ時間</Label>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="bufferBeforeMinutes">予定前(分)</Label>
                      <Input
                        id="bufferBeforeMinutes"
                        type="number"
                        min="0"
                        max="120"
                        step="5"
                        value={bufferBeforeMinutes}
                        onChange={(e) => setBufferBeforeMinutes(Number(e.target.value))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="bufferAfterMinutes">予定後(分)</Label>
                      <Input
                        id="bufferAfterMinutes"
                        type="number"
                        min="0"
                        max="120"
                        step="5"
                        value={bufferAfterMinutes}
                        onChange={(e) => setBufferAfterMinutes(Number(e.target.value))}
                      />
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    予定の前後に指定した分数を空き枠から除外します
                  </p>
                </div>

                <div className="space-y-3">
                  <Label>曜日選択</Label>
                  <div className="flex flex-wrap gap-3">
                    {[
                      { value: 0, label: '日' },
                      { value: 1, label: '月' },
                      { value: 2, label: '火' },
                      { value: 3, label: '水' },
                      { value: 4, label: '木' },
                      { value: 5, label: '金' },
                      { value: 6, label: '土' },
                    ].map((day) => (
                      <div key={day.value} className="flex items-center space-x-2">
                        <Checkbox
                          id={`day-${day.value}`}
                          checked={!excludedDays.includes(day.value)}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setExcludedDays(excludedDays.filter(d => d !== day.value));
                            } else {
                              setExcludedDays([...excludedDays, day.value]);
                            }
                          }}
                        />
                        <label
                          htmlFor={`day-${day.value}`}
                          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                        >
                          {day.label}
                        </label>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    チェックを外した曜日は除外されます
                  </p>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="mergeSlots"
                    checked={mergeSlots}
                    onCheckedChange={(checked) => setMergeSlots(checked as boolean)}
                  />
                  <label
                    htmlFor="mergeSlots"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                  >
                    連続した空き時間をまとめて表示
                  </label>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="ignoreAllDayEvents"
                    checked={ignoreAllDayEvents}
                    onCheckedChange={(checked) => setIgnoreAllDayEvents(checked as boolean)}
                  />
                  <label
                    htmlFor="ignoreAllDayEvents"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                  >
                    終日予定を除外（誕生日は常に除外）
                  </label>
                </div>

                <Button
                  onClick={handleCheckAvailability}
                  disabled={slotsLoading || selectedCalendarIds.length === 0}
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
              <>
                {/* Debug Info - Removed for production */}
                {false && availabilityData.debug && (
                  <Card className="mb-4 bg-yellow-50 border-yellow-200">
                    <CardHeader>
                      <CardTitle className="text-sm">デバッグ情報</CardTitle>
                    </CardHeader>
                    <CardContent className="text-xs font-mono space-y-1">
                      <div>入力開始日: {availabilityData.debug.inputStartDate}</div>
                      <div>入力終了日: {availabilityData.debug.inputEndDate}</div>
                      <div>パース後開始日: {availabilityData.debug.parsedStartDate}</div>
                      <div>パース後終了日: {availabilityData.debug.parsedEndDate}</div>
                      {availabilityData.debug.startDateComponents && (
                        <div>開始日コンポーネント: {JSON.stringify(availabilityData.debug.startDateComponents)}</div>
                      )}
                      {availabilityData.debug.endDateComponents && (
                        <div>終了日コンポーネント: {JSON.stringify(availabilityData.debug.endDateComponents)}</div>
                      )}
                      {availabilityData.debug.startDateNum && (
                        <div className="font-bold text-blue-600">startDateNum: {availabilityData.debug.startDateNum}</div>
                      )}
                      {availabilityData.debug.endDateNum && (
                        <div className="font-bold text-blue-600">endDateNum: {availabilityData.debug.endDateNum}</div>
                      )}
                      {availabilityData.debug.processedDates && (
                        <div className="font-bold text-green-600">処理された日付: {availabilityData.debug.processedDates.join(', ')}</div>
                      )}
                      <div>イベント数: {availabilityData.debug.totalEvents}</div>
                      <div>日付別スロット数:</div>
                      <pre className="pl-4">{JSON.stringify(availabilityData.debug.slotsByDate, null, 2)}</pre>
                    </CardContent>
                  </Card>
                )}
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle>空き時間一覧</CardTitle>
                        <CardDescription>
                          {availabilityData.totalSlots}件の空き枠が見つかりました
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
                  <Textarea
                    value={availabilityData.formattedText}
                    readOnly
                    className="min-h-[400px] font-mono text-sm"
                  />
                </CardContent>
              </Card>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
