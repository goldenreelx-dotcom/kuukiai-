// Vercel Serverless Function - Claude API endpoint
// プランに応じてHaiku/Sonnet/Opusを使い分ける

export default async function handler(req, res) {
    // CORSヘッダー
  res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
        return res.status(200).end();
  }

  if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
          return res.status(500).json({ error: 'APIキーが設定されていません' });
    }

  const { text, plan, scene } = req.body;

  if (!text || !text.trim()) {
        return res.status(400).json({ error: 'テキストを入力してください' });
  }

  // プランに応じたモデルの選択
  const modelMap = {
        free: 'claude-haiku-4-5-20251001',
        premium: 'claude-sonnet-4-6-20250514',
        pro: 'claude-opus-4-6-20250514'
  };

  const model = modelMap[plan] || modelMap.free;

  // 場面に応じたコンテキスト
  const sceneContext = {
        'LINE・チャット': 'カジュアルなメッセージアプリでの会話',
        'ビジネスメール': 'ビジネスシーンでのフォーマルなメール',
        'SNS投稿': 'TwitterやInstagramなどのSNS投稿',
        'その他': '一般的なテキストコミュニケーション'
  };

  const sceneDesc = sceneContext[scene] || sceneContext['その他'];

  // システムプロンプト
  const systemPrompt = `あなたは日本語コミュニケーションの「空気を読む」専門家AIです。
  相手のメッセージから、表面的な意味だけでなく「本音」や「隠された感情」を分析します。

  ## コンテキスト
  これは「${sceneDesc}」での会話です。

  ## 分析ルール
  1. 表面的な意味（surface）: メッセージが文字通り伝えていること
  2. 本音の推定（honne）: 言葉の裏にある本当の感情や意図。日本語特有の婉曲表現、空気、建前を考慮
  3. 感情スコア（emotions）: 以下5つを0-100で評価
     - 怒り: 怒りや苛立ち
        - 不満: 不満や不快感
           - 期待: 期待や希望
              - 好意: 好意や親しみ
                 - 不安: 不安や心配
                 4. 敬語レベル（keigo）: 1-5で評価
                    1=タメ口 2=カジュアル 3=標準敬語 4=丁寧 5=最上級敬語
                    5. おすすめ返信（replies）: 3パターンの返信案を提案

                    ## 出力形式（必ずこのJSON形式で返してください）
                    {
                      "surface": "表面的な意味の説明",
                        "honne": "本音の推定（2-3文で詳しく）",
                          "emotions": { "怒り": 数値, "不満": 数値, "期待": 数値, "好意": 数値, "不安": 数値 },
                            "keigo": 数値,
                              "replies": [
                                  { "tone": "トーンの名前", "text": "返信文" },
                                      { "tone": "トーンの名前", "text": "返信文" },
                                          { "tone": "トーンの名前", "text": "返信文" }
                                            ]
                                            }

                                            JSONのみを返してください。説明やマークダウンは不要です。`;

  try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                          'Content-Type': 'application/json',
                          'x-api-key': apiKey,
                          'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify({
                          model: model,
                          max_tokens: 1024,
                          system: systemPrompt,
                          messages: [
                            {
                                          role: 'user',
                                          content: `以下のメッセージの「空気」を読んでください:\n\n「${text}」`
                            }
                                    ]
                })
        });

      if (!response.ok) {
              const errorData = await response.json().catch(() => ({}));
              console.error('Anthropic API error:', response.status, errorData);
              return res.status(response.status).json({
                        error: 'AI分析に失敗しました',
                        detail: errorData.error?.message || 'Unknown error'
              });
      }

      const data = await response.json();
        const content = data.content[0].text;

      // JSONを抽出（余計なテキストが含まれる場合に備えて）
      let result;
        try {
                // まず直接パース
          result = JSON.parse(content);
        } catch {
                // JSONブロックを探す
          const jsonMatch = content.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                          result = JSON.parse(jsonMatch[0]);
                } else {
                          throw new Error('AIの応答をパースできませんでした');
                }
        }

      // レスポンスにモデル情報を追加（デバッグ用）
      result._model = model;
        result._plan = plan;

      return res.status(200).json(result);

  } catch (error) {
        console.error('Analysis error:', error);
        return res.status(500).json({
                error: '分析中にエラーが発生しました',
                detail: error.message
        });
  }
}
