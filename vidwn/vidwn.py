#!/usr/bin/env python3
# X Video Downloader
# Downloads videos from X (Twitter) at the highest available resolution
# Usage: python3 vidwn.py <tweet_url>

import sys
import subprocess

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 vidwn.py <tweet_url> [tweet_url2 ...]")
        print("Example: python3 vidwn.py https://x.com/user/status/123456789")
        print("For multiple: python3 vidwn.py url1 url2 url3")
        sys.exit(1)

    urls = sys.argv[1:]

    # Check if yt-dlp is installed
    try:
        subprocess.run(['yt-dlp', '--version'], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("\033[93myt-dlp not found. Installing...\033[0m")
        try:
            subprocess.run([sys.executable, '-m', 'pip', 'install', 'yt-dlp'], check=True)
        except subprocess.CalledProcessError:
            print("\033[91mFailed to install yt-dlp. Please install it manually from https://github.com/yt-dlp/yt-dlp\033[0m")
            sys.exit(1)

    # Download videos
    for i, url in enumerate(urls, 1):
        print(f"\033[94mDownloading video {i}/{len(urls)} from {url}...\033[0m")
        cmd = ['yt-dlp', '-f', 'bestvideo+bestaudio/best', '--merge-output-format', 'mp4', '--hls-use-mpegts', '-o', '%(title)s.%(ext)s', url]
        result = subprocess.run(cmd)
        if result.returncode == 0:
            print(f"\033[92mDownload {i} completed successfully.\033[0m")
        else:
            print(f"\033[91mDownload {i} failed.\033[0m")

    print("\033[92mAll downloads attempted.\033[0m")

if __name__ == "__main__":
    main()