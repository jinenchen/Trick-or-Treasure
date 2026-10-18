# Local static server with asynchronous streaming and HTTP byte ranges.
# Usage: powershell -ExecutionPolicy Bypass -File serve.ps1 [-Port 8080]
param([ValidateRange(1, 65535)][int]$Port = 8080)

# Requests run in .NET tasks, so a slow audio stream cannot block script/model
# requests. C# avoids invoking PowerShell scriptblocks without a runspace.
$serverSource = @'
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net;
using System.Threading.Tasks;

public sealed class HorrorStaticServer
{
    private readonly HttpListener listener = new HttpListener();
    private readonly string root;
    private readonly string rootPrefix;
    private static readonly Dictionary<string, string> Mime = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        { ".html", "text/html; charset=utf-8" }, { ".js", "text/javascript; charset=utf-8" },
        { ".css", "text/css; charset=utf-8" }, { ".json", "application/json" },
        { ".glb", "model/gltf-binary" }, { ".gltf", "model/gltf+json" },
        { ".bin", "application/octet-stream" }, { ".png", "image/png" },
        { ".jpg", "image/jpeg" }, { ".jpeg", "image/jpeg" }, { ".webp", "image/webp" },
        { ".svg", "image/svg+xml" }, { ".ico", "image/x-icon" },
        { ".mp3", "audio/mpeg" }, { ".ogg", "audio/ogg" }, { ".wav", "audio/wav" },
        { ".txt", "text/plain; charset=utf-8" }, { ".md", "text/plain; charset=utf-8" }
    };

    public HorrorStaticServer(string directory, int port)
    {
        root = Path.GetFullPath(directory).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        rootPrefix = root + Path.DirectorySeparatorChar;
        listener.Prefixes.Add("http://localhost:" + port.ToString(CultureInfo.InvariantCulture) + "/");
        listener.IgnoreWriteExceptions = true;
    }

    public Task Start()
    {
        listener.Start();
        return AcceptAsync();
    }

    public void Stop()
    {
        listener.Close();
    }

    private async Task AcceptAsync()
    {
        while (listener.IsListening)
        {
            HttpListenerContext context;
            try { context = await listener.GetContextAsync().ConfigureAwait(false); }
            catch (HttpListenerException) { break; }
            catch (ObjectDisposedException) { break; }
            QueueRequest(context);
        }
    }

    private void QueueRequest(HttpListenerContext context)
    {
        // ServeAsync catches request errors, including disconnected clients.
        Task.Run(() => ServeAsync(context));
    }

    private string ResolvePath(string absolutePath)
    {
        string relative = Uri.UnescapeDataString(absolutePath).TrimStart('/');
        if (relative.Length == 0) relative = "index.html";
        // Reject rooted paths, drive names, and alternate data stream syntax.
        if (Path.IsPathRooted(relative) || relative.IndexOf(':') >= 0) return null;
        string full = Path.GetFullPath(Path.Combine(root, relative.Replace('/', Path.DirectorySeparatorChar)));
        // The separator prevents a sibling such as repo-private matching repo.
        if (!full.StartsWith(rootPrefix, StringComparison.OrdinalIgnoreCase)) return null;
        return full;
    }

    private static bool TryRange(string value, long length, out long start, out long end)
    {
        start = 0;
        end = length - 1;
        if (length == 0) return false;
        string range = value.Substring(6).Trim();
        int dash = range.IndexOf('-');
        if (dash < 0 || range.IndexOf(',') >= 0 || range.IndexOf('-', dash + 1) >= 0) return false;
        string first = range.Substring(0, dash).Trim();
        string last = range.Substring(dash + 1).Trim();
        long parsed;
        if (first.Length == 0)
        {
            if (!long.TryParse(last, NumberStyles.None, CultureInfo.InvariantCulture, out parsed) || parsed <= 0) return false;
            start = Math.Max(0, length - parsed);
            return true;
        }
        if (!long.TryParse(first, NumberStyles.None, CultureInfo.InvariantCulture, out start) || start >= length) return false;
        if (last.Length > 0)
        {
            if (!long.TryParse(last, NumberStyles.None, CultureInfo.InvariantCulture, out parsed) || parsed < start) return false;
            end = Math.Min(end, parsed);
        }
        return true;
    }

    private async Task ServeAsync(HttpListenerContext context)
    {
        HttpListenerRequest request = context.Request;
        HttpListenerResponse response = context.Response;
        try
        {
            if (request.HttpMethod != "GET" && request.HttpMethod != "HEAD")
            {
                response.StatusCode = 405;
                response.Headers["Allow"] = "GET, HEAD";
                response.ContentLength64 = 0;
                return;
            }
            string full = ResolvePath(request.Url.AbsolutePath);
            if (full == null || !File.Exists(full))
            {
                response.StatusCode = 404;
                response.ContentLength64 = 0;
                return;
            }
            using (var file = new FileStream(full, FileMode.Open, FileAccess.Read, FileShare.ReadWrite,
                65536, FileOptions.Asynchronous | FileOptions.SequentialScan))
            {
                string contentType;
                response.ContentType = Mime.TryGetValue(Path.GetExtension(full), out contentType) ? contentType : "application/octet-stream";
                response.Headers["Cache-Control"] = "no-cache";
                response.Headers["Accept-Ranges"] = "bytes";
                long start = 0;
                long end = file.Length - 1;
                string range = request.Headers["Range"];
                // HEAD describes the full resource. Browsers use single ranges for media.
                if (request.HttpMethod == "GET" && range != null && range.StartsWith("bytes=", StringComparison.OrdinalIgnoreCase))
                {
                    if (!TryRange(range, file.Length, out start, out end))
                    {
                        response.StatusCode = 416;
                        response.Headers["Content-Range"] = "bytes */" + file.Length.ToString(CultureInfo.InvariantCulture);
                        response.ContentLength64 = 0;
                        return;
                    }
                    response.StatusCode = 206;
                    response.Headers["Content-Range"] = String.Format(CultureInfo.InvariantCulture, "bytes {0}-{1}/{2}", start, end, file.Length);
                }
                long remaining = Math.Max(0, end - start + 1);
                response.ContentLength64 = remaining;
                if (request.HttpMethod == "HEAD") return;
                file.Position = start;
                byte[] buffer = new byte[65536];
                while (remaining > 0)
                {
                    int count = await file.ReadAsync(buffer, 0, (int)Math.Min(buffer.Length, remaining)).ConfigureAwait(false);
                    if (count == 0) break;
                    await response.OutputStream.WriteAsync(buffer, 0, count).ConfigureAwait(false);
                    remaining -= count;
                }
            }
        }
        catch (HttpListenerException) { /* Client closed the stream. */ }
        catch (ObjectDisposedException) { /* Server or client closed the stream. */ }
        catch (Exception)
        {
            // Headers may already have been sent; closing is enough in that case.
            try { response.StatusCode = 500; response.ContentLength64 = 0; } catch { }
        }
        finally
        {
            try { response.Close(); } catch { }
        }
    }
}
'@

if (-not ('HorrorStaticServer' -as [type])) {
    Add-Type -TypeDefinition $serverSource -Language CSharp
}
$server = New-Object HorrorStaticServer($PSScriptRoot, $Port)
try {
    $serving = $server.Start()
    Write-Host "Serving $PSScriptRoot at http://localhost:$Port/  (Ctrl+C to stop)"
    # Keep PowerShell responsive to Ctrl+C while .NET accepts concurrent requests.
    while (-not $serving.IsCompleted) { Start-Sleep -Milliseconds 150 }
    $serving.GetAwaiter().GetResult()
} finally {
    $server.Stop()
}
