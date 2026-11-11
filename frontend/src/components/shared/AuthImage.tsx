import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import { apiClient } from "@/services/apiClient";

export async function downloadProtectedFile(
  url: string,
  filename: string
): Promise<void> {
  const response = await apiClient.get(url, { responseType: "blob" });
  const blobUrl = window.URL.createObjectURL(response.data);
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(blobUrl), 1000);
}

export function AuthImage({
  src,
  alt,
  className = "",
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let createdUrl: string | null = null;
    setFailed(false);
    setObjectUrl(null);

    apiClient
      .get(src, { responseType: "blob" })
      .then((res) => {
        if (!active) return;
        createdUrl = window.URL.createObjectURL(res.data);
        setObjectUrl(createdUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });

    return () => {
      active = false;
      if (createdUrl) {
        window.URL.revokeObjectURL(createdUrl);
      }
    };
  }, [src]);

  if (failed) {
    return (
      <div
        className={`flex items-center justify-center rounded-lg border border-slate-200 bg-slate-100 text-slate-400 ${className}`}
      >
        <ImageOff className="h-5 w-5" />
      </div>
    );
  }

  if (!objectUrl) {
    return (
      <div
        className={`animate-pulse rounded-lg bg-slate-200 ${className}`}
        aria-label="Loading image"
      />
    );
  }

  return <img src={objectUrl} alt={alt} className={className} />;
}

