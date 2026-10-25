@rem Gradle startup script for Windows. Regenerate the wrapper jar via Android Studio
@rem if it is missing (this repo ships text-only).
@echo off
setlocal
set DIR=%~dp0
set WRAPPER_JAR=%DIR%gradle\wrapper\gradle-wrapper.jar
if not exist "%WRAPPER_JAR%" (
  where gradle >nul 2>nul && (
    echo gradle-wrapper.jar missing - generating it...
    pushd "%DIR%" && gradle wrapper --gradle-version 8.7 --no-daemon && popd
  ) || (
    echo ERROR: gradle-wrapper.jar missing and no system gradle found.
    echo Open the project once in Android Studio to regenerate the wrapper.
    exit /b 1
  )
)
java -classpath "%WRAPPER_JAR%" org.gradle.wrapper.GradleWrapperMain %*
endlocal
