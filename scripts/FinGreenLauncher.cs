using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Threading;

namespace FinGreen
{
    class Program
    {
        static void Main(string[] args)
        {
            try
            {
                string baseDir = AppDomain.CurrentDomain.BaseDirectory;
                Directory.SetCurrentDirectory(baseDir);

                // Check if server is already running
                bool serverRunning = IsServerOnline("http://localhost:3721/api/settings");

                if (!serverRunning)
                {
                    // Start Node server silently in background
                    ProcessStartInfo psi = new ProcessStartInfo();
                    psi.FileName = "cmd.exe";
                    psi.Arguments = "/c npx tsx src/server/app-server.ts";
                    psi.WorkingDirectory = baseDir;
                    psi.WindowStyle = ProcessWindowStyle.Hidden;
                    psi.CreateNoWindow = true;
                    psi.UseShellExecute = false;

                    Process.Start(psi);

                    // Wait up to 5 seconds for server to be responsive
                    for (int i = 0; i < 10; i++)
                    {
                        Thread.Sleep(500);
                        if (IsServerOnline("http://localhost:3721/api/settings"))
                        {
                            break;
                        }
                    }
                }

                // Launch App Window
                LaunchAppWindow("http://localhost:3721");
            }
            catch (Exception ex)
            {
                // Fallback: open default browser
                try
                {
                    Process.Start("http://localhost:3721");
                }
                catch { }
            }
        }

        static bool IsServerOnline(string url)
        {
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(url);
                req.Timeout = 1000;
                req.Method = "GET";
                using (HttpWebResponse res = (HttpWebResponse)req.GetResponse())
                {
                    return res.StatusCode == HttpStatusCode.OK;
                }
            }
            catch
            {
                return false;
            }
        }

        static void LaunchAppWindow(string url)
        {
            string chrome1 = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Google\Chrome\Application\chrome.exe");
            string chrome2 = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Google\Chrome\Application\chrome.exe");
            string chrome3 = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Google\Chrome\Application\chrome.exe");

            string edge1 = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Microsoft\Edge\Application\msedge.exe");
            string edge2 = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Microsoft\Edge\Application\msedge.exe");

            string browserPath = null;
            if (File.Exists(chrome1)) browserPath = chrome1;
            else if (File.Exists(chrome2)) browserPath = chrome2;
            else if (File.Exists(chrome3)) browserPath = chrome3;
            else if (File.Exists(edge1)) browserPath = edge1;
            else if (File.Exists(edge2)) browserPath = edge2;

            if (browserPath != null)
            {
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = browserPath;
                psi.Arguments = string.Format("--app={0} --window-size=1440,900", url);
                Process.Start(psi);
            }
            else
            {
                Process.Start(url);
            }
        }
    }
}

