import { useEffect, useState } from "react";
import { Box, Download, FileJson, ImageIcon } from "lucide-react";
import { artifactDownloadUrl, artifactUrl, type ArtifactRecord } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ObjModelViewer } from "@/components/ObjModelViewer";
import { isObjModelArtifact } from "@/lib/modelPreview";

export function ArtifactPreview({ artifact }: { artifact: ArtifactRecord }): JSX.Element {
  const [fileUrl, setFileUrl] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");

  useEffect(() => {
    void artifactUrl(artifact.id).then(setFileUrl);
    void artifactDownloadUrl(artifact.id).then(setDownloadUrl);
  }, [artifact.id]);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex min-w-0 items-center gap-2 text-sm">
          {artifact.kind === "model" ? <Box className="h-4 w-4" /> : null}
          {artifact.kind === "image" || artifact.kind === "screenshot" ? <ImageIcon className="h-4 w-4" /> : null}
          {artifact.kind === "json" ? <FileJson className="h-4 w-4" /> : null}
          <span className="truncate">{artifact.name}</span>
        </CardTitle>
        <Button asChild variant="outline" size="sm">
          <a href={downloadUrl}>
            <Download className="h-4 w-4" />
            Download
          </a>
        </Button>
      </CardHeader>
      <CardContent>
        {artifact.kind === "image" || artifact.kind === "screenshot" ? (
          <img src={fileUrl} alt={artifact.name} className="max-h-80 w-full rounded-md object-contain bg-muted" />
        ) : null}
        {artifact.kind === "model" ? (
          isObjModelArtifact(artifact) ? (
            <ObjModelViewer artifact={artifact} />
          ) : (
            <div className="rounded-md bg-muted p-4 text-sm text-muted-foreground">
              MODEL artifact - {Math.round(artifact.size / 1024)} KB
            </div>
          )
        ) : null}
        {artifact.kind !== "image" && artifact.kind !== "screenshot" && artifact.kind !== "model" ? (
          <div className="rounded-md bg-muted p-4 text-sm text-muted-foreground">
            {artifact.kind.toUpperCase()} artifact · {Math.round(artifact.size / 1024)} KB
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
