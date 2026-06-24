import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import type { Provider } from "@/lib/types";

const PROVIDER_LABELS: Record<Provider, string> = {
  claude: "Claude",
  openai: "OpenAI",
  deepseek: "DeepSeek",
};

export function UrlStep({
  url,
  setUrl,
  provider,
  setProvider,
  availProviders,
  loading,
  onAnalyze,
}: {
  url: string;
  setUrl: (v: string) => void;
  provider: Provider;
  setProvider: (p: Provider) => void;
  availProviders: Provider[];
  loading: boolean;
  onAnalyze: () => void;
}) {
  return (
    <Card className="p-6">
      <label htmlFor="url" className="mb-2 block text-sm font-medium">
        Product URL
      </label>
      <input
        id="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && url && !loading && onAnalyze()}
        placeholder="yourproduct.com"
        className="w-full rounded-lg border border-line bg-surface-2 px-4 py-3 text-sm outline-none transition-colors focus:border-accent-500"
      />

      {availProviders.length > 1 && (
        <div className="mt-4 flex items-center gap-2 text-xs">
          <span className="text-neutral-400">Model:</span>
          {availProviders.map((p) => (
            <button
              key={p}
              onClick={() => setProvider(p)}
              className={`rounded-full px-3 py-1 transition-colors ${
                provider === p
                  ? "bg-accent-600 text-white"
                  : "bg-surface-2 text-neutral-300 hover:text-white"
              }`}
            >
              {PROVIDER_LABELS[p]}
            </button>
          ))}
        </div>
      )}

      <Button
        onClick={onAnalyze}
        disabled={!url || loading}
        className="mt-5"
      >
        Analyze product →
      </Button>
    </Card>
  );
}
