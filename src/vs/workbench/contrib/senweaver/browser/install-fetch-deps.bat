@echo off
echo Installing enhanced fetch_url dependencies...
echo.
echo This will install:
echo - axios: HTTP client with redirect support
echo - jsdom: JavaScript DOM implementation
echo - @mozilla/readability: Mozilla's Readability algorithm
echo - turndown: HTML to Markdown converter
echo.

cd /d "%~dp0..\..\..\..\..\.."

echo Installing dependencies...
call npm install axios jsdom @mozilla/readability turndown --save

echo.
echo ✅ Installation complete!
echo.
echo The fetch_url backend server will now use enhanced libraries for:
echo - Better HTTP request handling
echo - Intelligent content extraction
echo - High-quality HTML to Markdown conversion
echo.
pause
