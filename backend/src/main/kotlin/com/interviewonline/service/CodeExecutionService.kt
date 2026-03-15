package com.interviewonline.service

import com.interviewonline.config.ExecutionProperties
import com.interviewonline.dto.RunCodeRequest
import com.interviewonline.dto.RunCodeResponse
import org.springframework.http.MediaType
import org.springframework.stereotype.Service
import org.springframework.web.client.RestClient
import java.nio.file.Files
import java.nio.file.Path
import java.time.Duration
import java.util.concurrent.TimeUnit

@Service
class CodeExecutionService(
    private val executionProperties: ExecutionProperties,
    private val restClientBuilder: RestClient.Builder,
) {
    fun run(request: RunCodeRequest): RunCodeResponse {
        if (executionProperties.killSwitch) {
            return RunCodeResponse(
                stdout = "",
                stderr = "Code execution временно выключен kill-switch политикой безопасности",
                exitCode = 3,
                timedOut = false,
            )
        }
        return when (executionProperties.mode.lowercase()) {
            "isolated" -> runInIsolatedWorker(request)
            else -> runLocal(request)
        }
    }

    private fun runLocal(request: RunCodeRequest): RunCodeResponse {
        if (!executionProperties.localEnabled) {
            return RunCodeResponse(
                stdout = "",
                stderr = "Локальный runner отключен политикой безопасности. Переключите app.execution.mode=isolated",
                exitCode = 3,
                timedOut = false,
            )
        }

        val language = request.language.lowercase()
        val (filename, command) = when (language) {
            "javascript", "typescript" -> "main.js" to listOf("node", "main.js")
            "python" -> "main.py" to listOf("python3", "main.py")
            else -> {
                return RunCodeResponse(
                    stdout = "",
                    stderr = "Язык '$language' пока не поддерживается в раннере MVP",
                    exitCode = 2,
                    timedOut = false,
                )
            }
        }

        val tempDir = Files.createTempDirectory("io-runner-")
        return try {
            val source = tempDir.resolve(filename)
            Files.writeString(source, request.code)
            val result = execute(command, tempDir)
            result
        } finally {
            tempDir.toFile().deleteRecursively()
        }
    }

    private fun runInIsolatedWorker(request: RunCodeRequest): RunCodeResponse {
        return try {
            restClientBuilder.build()
                .post()
                .uri(executionProperties.isolatedUrl)
                .contentType(MediaType.APPLICATION_JSON)
                .body(request)
                .retrieve()
                .body(RunCodeResponse::class.java)
                ?: RunCodeResponse(
                    stdout = "",
                    stderr = "Isolated runner вернул пустой ответ",
                    exitCode = 3,
                    timedOut = false,
                )
        } catch (ex: Exception) {
            if (executionProperties.fallbackToLocal && executionProperties.localEnabled) {
                return runLocal(request).copy(
                    stderr = "Isolated runner недоступен, использован fallback local runner",
                )
            }
            RunCodeResponse(
                stdout = "",
                stderr = "Не удалось выполнить код через isolated runner: ${ex.message}",
                exitCode = 3,
                timedOut = false,
            )
        }
    }

    private fun execute(command: List<String>, workingDir: Path): RunCodeResponse {
        val process = ProcessBuilder(command)
            .directory(workingDir.toFile())
            .redirectErrorStream(false)
            .start()
        val timeout = Duration.ofSeconds(4)
        val finished = process.waitFor(timeout.toMillis(), TimeUnit.MILLISECONDS)
        if (!finished) {
            process.destroyForcibly()
            return RunCodeResponse(
                stdout = "",
                stderr = "Превышено время выполнения",
                exitCode = 124,
                timedOut = true,
            )
        }
        val stdout = process.inputStream.bufferedReader().readText().take(8000)
        val stderr = process.errorStream.bufferedReader().readText().take(8000)
        return RunCodeResponse(
            stdout = stdout,
            stderr = stderr,
            exitCode = process.exitValue(),
            timedOut = false,
        )
    }
}
