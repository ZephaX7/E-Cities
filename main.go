package main

import (
    "fmt"
    "log"
    "net/http"
    "os"
    "os/exec"
    "runtime"
    "time"
)

func main() {
    port := "8080"
    if p := os.Getenv("PORT"); p != "" {
        port = p
    }

    dir := "."

    // We'll serve static files from the project root but make the root URL
    // (/) return templates/dossier1/index.html so visitors don't see a directory listing.
    fs := http.FileServer(http.Dir(dir))
    handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        // If the request is exactly for the site root, serve the template index.
        if r.URL.Path == "/" || r.URL.Path == "" {
            http.ServeFile(w, r, "templates/dossier1/index.html")
            return
        }
        // Otherwise serve static files normally.
        fs.ServeHTTP(w, r)
    })

    url := fmt.Sprintf("http://localhost:%s/", port)

    srv := &http.Server{
        Addr:    ":" + port,
        Handler: handler,
    }

    go func() {
        fmt.Printf("Serving %s on http://localhost:%s (press Ctrl+C to stop)\n", dir, port)
        if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
            log.Fatalf("server error: %v", err)
        }
    }()

    time.Sleep(500 * time.Millisecond)
    if err := openBrowser(url); err != nil {
        fmt.Println("Could not open browser automatically. Open this URL manually:", url)
    }

    select {}
}

func openBrowser(url string) error {
    var cmd *exec.Cmd
    switch runtime.GOOS {
    case "windows":
        cmd = exec.Command("cmd", "/c", "start", "", url)
    case "darwin":
        cmd = exec.Command("open", url)
    default:
        cmd = exec.Command("xdg-open", url)
    }
    cmd.Env = os.Environ()
    return cmd.Start()
}
