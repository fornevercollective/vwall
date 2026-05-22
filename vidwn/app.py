from flask import Flask, request, render_template_string, session, send_file
import subprocess
import json
import tempfile
import os

app = Flask(__name__, static_folder='/Users/tref/Desktop/vwall')
app.secret_key = 'x_video_player_secret_key'



@app.route('/', methods=['GET', 'POST'])
def index():
    video_url = None
    error = None
    formats = []
    thumbnail = None
    if request.method == 'POST':
        tweet_url = request.form.get('url', '').strip()
        format_id = request.form.get('format_id')
        if tweet_url and not format_id:
            # Fetch formats for the URL
            try:
                result = subprocess.run(['yt-dlp', '--dump-json', tweet_url], capture_output=True, text=True, timeout=30)
                if result.returncode == 0:
                    data = json.loads(result.stdout)
                    all_formats = data.get('formats', [])
                    formats = [f for f in all_formats if f.get('vcodec') != 'none']
                    if formats:
                        session['formats'] = formats
                        session['tweet_url'] = tweet_url
                        thumbnail = data.get('thumbnail')
                        session['thumbnail'] = thumbnail
                        session['title'] = data.get('title')
                        session['duration'] = data.get('duration')
                        session['uploader'] = data.get('uploader')
                        session['description'] = data.get('description')
                        session['subtitles'] = data.get('subtitles', {})
                        # Add to history
                        history = session.get('history', [])
                        if tweet_url not in history:
                            history.insert(0, tweet_url)
                            session['history'] = history[:5]  # Keep last 5
                    else:
                        error = "No video formats found."
                else:
                    error = "Failed to fetch video info. Check the URL."
            except subprocess.TimeoutExpired:
                error = "Request timed out."
            except json.JSONDecodeError:
                error = "Invalid response from yt-dlp."
            except Exception as e:
                error = f"Error: {str(e)}"
        elif format_id and 'formats' in session:
            # Use selected format
            for f in session['formats']:
                if str(f.get('format_id')) == format_id:
                    video_url = f['url']
                    break
            if not video_url:
                error = "Selected format not found."
        else:
            if not tweet_url:
                error = "Please enter a tweet URL."

    html = '''
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <title>X Video Player</title>
        <link rel="stylesheet" href="/styles.css">
        <style>
            /* Additional styles */
            #main {
                padding: 20px;
                padding-top: 60px;
                padding-bottom: 80px;
                color: #ccc;
            }
            #main h1 { color: #fff; }
            #main form { margin-bottom: 20px; }
            #main video { width: 100%; max-width: 800px; margin-top: 20px; border-radius: 8px; }
            .error { color: #f88; }
            .preview-meta { display: flex; gap: 20px; margin-top: 20px; }
            .preview-meta iframe { border-radius: 8px; }
            .metadata { flex: 1; }
            .metadata h4 { color: #fff; margin-top: 0; }
            .metadata p { margin: 8px 0; }
            #drawer .meta { font-size: 14px; line-height: 1.8; }
            #drawer .meta span { color: #aaa; }
        </style>
    </head>
    <body>
    <div id="header">
        <div class="header-left">
            <span>X Video Downloader</span>
        </div>
        <div class="header-right">
            <span id="perf">--</span>
        </div>
    </div>
    <div id="main">
        <h1>Paste Tweet URL to Play Video</h1>
        {% if history %}
        <h3>Recent Searches:</h3>
        <ul>
            {% for url in history %}
            <li><a href="#" onclick="document.querySelector('input[name=url]').value='{{ url }}'; return false;">{{ url }}</a></li>
            {% endfor %}
        </ul>
        {% endif %}
        {% if error %}
            <p class="error">{{ error }}</p>
        {% endif %}
    </div>
    <footer>
        <form method="post" style="display: flex; width: 100%; gap: 8px;">
            <input id="search" type="text" name="url" placeholder="https://x.com/username/status/123456789" required style="flex: 1;">
            <button type="submit">Load Video</button>
            <button type="button" onclick="document.getElementById('drawer').classList.toggle('open')">Formats</button>
        </form>
    </footer>
    <div id="drawer">
        <button class="close-btn" onclick="document.getElementById('drawer').classList.remove('open')">×</button>
        <h2>Video Formats</h2>
        {% if formats %}
            <h3>Select Video Resolution:</h3>
            <form method="post">
                <input type="hidden" name="url" value="{{ tweet_url }}">
                <select name="format_id" required>
                    {% for f in formats %}
                    <option value="{{ f.format_id }}">{{ f.height or 'N/A' }}p - {{ f.ext }} - {{ f.vcodec }} ({{ f.filesize | default('Unknown size') }})</option>
                    {% endfor %}
                </select>
                <input type="submit" value="Load Video">
            </form>
            <div style="display: flex; align-items: flex-start;">
                <div style="margin-right: 20px;">
                    <h4>Tweet Preview:</h4>
                    <iframe src="{{ tweet_url }}" width="300" height="400" frameborder="0" style="border: 1px solid #ccc;"></iframe>
                    <p><small>If preview doesn't load, <a href="{{ tweet_url }}" target="_blank">open in new tab</a>.</small></p>
                </div>
                <div>
                    <h4>Video Metadata:</h4>
                    {% if title %}<p><strong>Title:</strong> {{ title }}</p>{% endif %}
                    {% if duration %}<p><strong>Duration:</strong> {{ duration }} seconds</p>{% endif %}
                    {% if uploader %}<p><strong>Uploader:</strong> {{ uploader }}</p>{% endif %}
                    {% if description %}<p><strong>Description:</strong> {{ description }}</p>{% endif %}
                    {% if subtitles %}<p><strong>Subtitles:</strong> {{ subtitles.keys() | list | join(', ') }}</p>{% endif %}
                </div>
            </div>
            <h4>Available Formats Metadata:</h4>
            <p><strong>Original Source (Tweet URL):</strong> {{ tweet_url }}</p>
            <table border="1" style="border-collapse: collapse; width: 100%; max-width: 800px;">
                <tr style="background-color: #2a2a2a;">
                    <th>Thumbnail</th>
                    <th>Format ID</th>
                    <th>Width</th>
                    <th>Height</th>
                    <th>Extension</th>
                    <th>Video Codec</th>
                    <th>Audio Codec</th>
                    <th>Audio Bitrate</th>
                    <th>FPS</th>
                    <th>Video Bitrate</th>
                    <th>File Size</th>
                    <th>Stored Source URL</th>
                </tr>
                {% for f in formats %}
                <tr>
                    <td>{% if thumbnail %}<img src="{{ thumbnail }}" alt="Thumbnail" width="100">{% else %}No Thumb{% endif %}</td>
                    <td>{{ f.format_id }}</td>
                    <td>{{ f.width or 'N/A' }}</td>
                    <td>{{ f.height or 'N/A' }}</td>
                    <td>{{ f.ext }}</td>
                    <td>{{ f.vcodec }}</td>
                    <td>{{ f.acodec or 'none' }}</td>
                    <td>{{ f.abr or 'N/A' }}</td>
                    <td>{{ f.fps or 'N/A' }}</td>
                    <td>{{ f.vbr or 'N/A' }}</td>
                    <td>{{ f.filesize | default('Unknown') }}</td>
                    <td><a href="/download/{{ f.format_id }}">Download {{ f.format_id }}.mp4</a></td>
                </tr>
                {% endfor %}
            </table>
            <p><em>Note: If the download doesn't start automatically, right-click the link and select 'Save link as'.</em></p>
        {% endif %}
        {% if video_url %}
            <h2>Video:</h2>
            <video controls width="100%" style="max-width: 800px;">
                <source src="{{ video_url }}" type="video/mp4">
                <source src="{{ video_url }}" type="video/webm">
                <source src="{{ video_url }}" type="video/ogg">
                Your browser does not support the video tag.
            </video>
            <p>If the video doesn't play in the browser, <a href="{{ video_url }}" target="_blank">open in new tab</a> or download and play in an external player. If videos don't load, allow mixed content in your browser settings (e.g., in Chrome: click the lock icon > Site settings > Insecure content > Allow).</p>
            <div class="preview-meta">
                <div>
                    <h4>Tweet Preview:</h4>
                    <iframe src="{{ tweet_url }}" width="300" height="400" frameborder="0" style="border: 1px solid #ccc;"></iframe>
                    <p><small>If preview doesn't load, <a href="{{ tweet_url }}" target="_blank">open in new tab</a>.</small></p>
                </div>
                <div class="metadata">
                    <h4>Video Metadata:</h4>
                    {% if title %}<p><strong>Title:</strong> {{ title }}</p>{% endif %}
                    {% if duration %}<p><strong>Duration:</strong> {{ duration }} seconds</p>{% endif %}
                    {% if uploader %}<p><strong>Uploader:</strong> {{ uploader }}</p>{% endif %}
                    {% if description %}<p><strong>Description:</strong> {{ description }}</p>{% endif %}
                    {% if subtitles %}<p><strong>Subtitles:</strong> {{ subtitles.keys() | list | join(', ') }}</p>{% endif %}
                    <details>
                        <summary>Media Information</summary>
                        {% for f in formats %}
                            {% if f.url == video_url %}
                                <h4>General</h4>
                                <p><strong>Filename:</strong> {{ f.format_id }}.{{ f.ext }}</p>
                                <p><strong>Format:</strong> {{ f.ext }}</p>
                                <p><strong>Duration:</strong> {{ duration or 'N/A' }} seconds</p>
                                <p><strong>Size:</strong> {{ f.filesize | default('Unknown') }} bytes</p>
                                <h4>Video</h4>
                                <p><strong>Codec:</strong> {{ f.vcodec }}</p>
                                <p><strong>Resolution:</strong> {{ f.width or 'N/A' }}x{{ f.height or 'N/A' }}</p>
                                <p><strong>Frame Rate:</strong> {{ f.fps or 'N/A' }} fps</p>
                                <p><strong>Bitrate:</strong> {{ f.vbr or 'N/A' }} kbps</p>
                                <h4>Audio</h4>
                                <p><strong>Codec:</strong> {{ f.acodec or 'none' }}</p>
                                <p><strong>Channels:</strong> {{ f.audio_channels or 'N/A' }}</p>
                                <p><strong>Sample Rate:</strong> {{ f.asr or 'N/A' }} Hz</p>
                                <p><strong>Bitrate:</strong> {{ f.abr or 'N/A' }} kbps</p>
                            {% endif %}
                        {% endfor %}
                    </details>
                    <br>
                    <a href="/download/{{ (formats | selectattr('url', 'equalto', video_url) | first).format_id }}">Download Video</a>
                </div>
            </div>
        {% endif %}
    </div>
    <div id="settings"></div>
    </body>
    </html>
    '''
    return render_template_string(html, video_url=video_url, error=error, formats=session.get('formats', []), tweet_url=session.get('tweet_url', ''), thumbnail=session.get('thumbnail'), title=session.get('title'), duration=session.get('duration'), uploader=session.get('uploader'), description=session.get('description'), subtitles=session.get('subtitles', {}), history=session.get('history', []))

@app.route('/download/<format_id>')
def download(format_id):
    if 'formats' not in session or 'tweet_url' not in session:
        return "No video loaded", 404
    url = session['tweet_url']
    for f in session['formats']:
        if str(f.get('format_id')) == format_id:
            with tempfile.NamedTemporaryFile(delete=False, suffix=".mp4") as tmp:
                tmp_path = tmp.name
            try:
                proc = subprocess.run(['yt-dlp', '-f', format_id, '--merge-output-format', 'mp4', '--recode-video', 'mp4', '--hls-use-mpegts', '-o', tmp_path, url])
                if proc.returncode == 0:
                    response = send_file(tmp_path, as_attachment=True, download_name=f"{f.get('format_id', 'video')}.mp4")
                    # Schedule cleanup after response
                    @response.call_on_close
                    def cleanup():
                        try:
                            os.unlink(tmp_path)
                        except:
                            pass
                    return response
                else:
                    os.unlink(tmp_path)
                    return "Download failed", 500
            except Exception as e:
                if os.path.exists(tmp_path):
                    os.unlink(tmp_path)
                return f"Error: {str(e)}", 500
    return "Format not found", 404

if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5000, debug=False)