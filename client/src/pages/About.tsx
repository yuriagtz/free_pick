import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft } from "lucide-react";
import { Link, useLocation } from "wouter";

export default function About() {
  const [, setLocation] = useLocation();

  const handleGoBack = () => {
    setLocation("/");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-8 px-4">
      <div className="container max-w-4xl mx-auto">
        <Button
          variant="ghost"
          onClick={handleGoBack}
          className="mb-6"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          戻る
        </Button>

        <Card className="shadow-lg">
          <CardContent className="pt-8 pb-8 px-8 space-y-10">
            <header className="space-y-4">
              <p className="text-sm font-medium text-blue-600 uppercase tracking-wide">About</p>
              <h1 className="text-3xl font-bold text-gray-900">サービスについて（About FreePick）</h1>
              <p className="text-lg text-gray-700 leading-relaxed">
                FreePickは、Googleカレンダーの予定を読み取り専用で参照し、既存の予定から空き時間を自動抽出するWebアプリケーションです。面談や打ち合わせ調整が多い個人・小規模事業者、フリーランス、営業職、採用担当者などが、候補時間を迅速に提示できるよう設計されています。
              </p>
            </header>

            <section className="space-y-4">
              <h2 className="text-2xl font-semibold text-gray-900">利用イメージ</h2>
              <p className="text-gray-700 leading-relaxed">
                Googleでサインインすると、FreePickが読み取り専用スコープで予定を取得し、重複や終日予定も考慮しながら空いている時間帯を抽出します。抽出した候補スロットは一覧化され、コピーや共有が容易です。予定を作成・変更・削除することは一切ありません。
              </p>
            </section>

            <section className="space-y-4">
              <h2 className="text-2xl font-semibold text-gray-900">主要機能</h2>
              <ul className="list-disc list-inside space-y-2 text-gray-700">
                <li>既存予定をもとにした空き時間の自動抽出</li>
                <li>空き時間候補のリスト化および共有補助</li>
                <li>ログイン中のユーザー名・メールアドレス表示によるアカウント識別</li>
              </ul>
            </section>

            <section className="space-y-4">
              <h2 className="text-2xl font-semibold text-gray-900">Google OAuthの利用目的（取得スコープ）</h2>
              <dl className="space-y-4 text-gray-700">
                <div>
                  <dt className="font-medium">userinfo.email / userinfo.profile</dt>
                  <dd className="mt-1 leading-relaxed">
                    ログインユーザーの識別、画面上でのプロフィール表示、内部的なアカウント紐づけに使用します。
                  </dd>
                </div>
                <div>
                  <dt className="font-medium">calendar.readonly / calendar.events.readonly</dt>
                  <dd className="mt-1 leading-relaxed">
                    Googleカレンダーの予定を読み取り、既存イベントから空き時間を算出するために使用します。
                  </dd>
                </div>
              </dl>
              <p className="text-sm text-gray-600">
                いずれのスコープも読み取り専用であり、予定の作成・変更・削除や第三者提供は行いません。
              </p>
            </section>

            <section className="space-y-4">
              <h2 className="text-2xl font-semibold text-gray-900">English Summary</h2>
              <p className="text-gray-700 leading-relaxed">
                FreePick is a web application that accesses your Google Calendar in read-only mode, analyzes existing events, and generates shareable lists of available time slots. It is designed for individuals and small teams who frequently schedule meetings. We only use your profile information to identify your account within FreePick, and we do not modify, delete, or share your data.
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-2xl font-semibold text-gray-900">お問い合わせ</h2>
              <p className="text-gray-700">g.tz.kaz@gmail.com</p>
            </section>

            <footer className="flex flex-wrap gap-4 text-sm text-blue-600">
              <Link href="/" className="hover:underline">
                ホームに戻る
              </Link>
              <Link href="/privacy-policy" className="hover:underline">
                プライバシーポリシー
              </Link>
            </footer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}


