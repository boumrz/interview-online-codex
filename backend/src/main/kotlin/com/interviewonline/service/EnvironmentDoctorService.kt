package com.interviewonline.service

import com.interviewonline.config.ExecutionProperties
import com.interviewonline.dto.EnvironmentDoctorCheckDto
import com.interviewonline.dto.EnvironmentDoctorReportDto
import org.springframework.http.MediaType
import org.springframework.stereotype.Service
import org.springframework.web.client.RestClient
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths
import java.time.Instant
import java.time.format.DateTimeFormatter
import java.util.concurrent.TimeUnit

@Service
class EnvironmentDoctorService(
    private val executionProperties: ExecutionProperties,
    private val restClientBuilder: RestClient.Builder,
) {
    fun run(): EnvironmentDoctorReportDto {
        val checks = mutableListOf<EnvironmentDoctorCheckDto>()

        val javaResult = commandVersion(listOf("java", "-version"), "java_runtime", readStderr = true)
        val mavenResult = commandVersion(listOf("mvn", "-version"), "maven", readStderr = false)
        val nodeResult = commandVersion(listOf("node", "--version"), "node", readStderr = false)
        val npmResult = commandVersion(listOf("npm", "--version"), "npm", readStderr = false)
        val playwrightResult = commandVersion(listOf("npx", "playwright", "--version"), "playwright", readStderr = false)

        checks += javaResult.check
        checks += mavenResult.check
        checks += nodeResult.check
        checks += npmResult.check
        checks += if (playwrightResult.check.status == "FAIL") {
            playwrightResult.check.copy(status = "WARN", message = "Playwright не найден или недоступен")
        } else {
            playwrightResult.check
        }

        checks += checkExecutionRunner()

        val projectLayout = resolveProjectLayout()
        val readme = readFile(projectLayout.rootDir.resolve("README.md"))
        val pom = readFile(projectLayout.backendDir.resolve("pom.xml"))
        val gradle = readFile(projectLayout.backendDir.resolve("build.gradle.kts"))

        val readmeJava = extractFirst(readme, Regex("temurin-(\\d+)"))
        val pomJava = extractFirst(pom, Regex("<java.version>(\\d+)</java.version>"))
        val pomKotlin = extractFirst(pom, Regex("<kotlin.version>([^<]+)</kotlin.version>"))
        val gradleJava = extractFirst(gradle, Regex("JavaLanguageVersion\\.of\\((\\d+)\\)"))

        val declared = listOfNotNull(
            readmeJava?.let { "README=$it" },
            pomJava?.let { "pom.xml=$it" },
            gradleJava?.let { "build.gradle.kts=$it" },
        )

        val declaredUnique = listOfNotNull(readmeJava, pomJava, gradleJava).toSet()
        checks += if (declaredUnique.size <= 1 && declaredUnique.isNotEmpty()) {
            EnvironmentDoctorCheckDto(
                key = "java_target_consistency",
                status = "PASS",
                message = "Java target versions согласованы (${declared.joinToString(", ")})",
            )
        } else {
            EnvironmentDoctorCheckDto(
                key = "java_target_consistency",
                status = "FAIL",
                message = "Конфликт Java target versions: ${declared.joinToString(", ")}",
                details = mapOf(
                    "recommendation" to "Приведите README, pom.xml и build.gradle.kts к одной версии Java",
                ),
            )
        }

        val javaRuntimeMajor = extractJavaMajor(javaResult.versionRaw)
        if (javaRuntimeMajor != null && pomKotlin != null && javaRuntimeMajor >= 25 && compareVersions(pomKotlin, "1.9.25") <= 0) {
            checks += EnvironmentDoctorCheckDto(
                key = "kotlin_maven_java_compatibility",
                status = "FAIL",
                message = "Обнаружен риск несовместимости: Java runtime $javaRuntimeMajor и kotlin-maven-plugin $pomKotlin",
                details = mapOf(
                    "recommendation" to "Используйте Java 17/21 для сборки либо обновите Kotlin plugin до версии с поддержкой Java runtime",
                ),
            )
        } else {
            checks += EnvironmentDoctorCheckDto(
                key = "kotlin_maven_java_compatibility",
                status = "PASS",
                message = "Критичный конфликт Kotlin Maven plugin и Java runtime не обнаружен",
            )
        }

        val status = when {
            checks.any { it.status == "FAIL" } -> "FAIL"
            checks.any { it.status == "WARN" } -> "WARN"
            else -> "PASS"
        }

        return EnvironmentDoctorReportDto(
            status = status,
            generatedAt = DateTimeFormatter.ISO_INSTANT.format(Instant.now()),
            checks = checks,
        )
    }

    private fun commandVersion(command: List<String>, key: String, readStderr: Boolean): CommandResult {
        return try {
            val process = ProcessBuilder(command).start()
            val completed = process.waitFor(8, TimeUnit.SECONDS)
            if (!completed) {
                process.destroyForcibly()
                return CommandResult(
                    versionRaw = null,
                    check = EnvironmentDoctorCheckDto(
                        key = key,
                        status = "FAIL",
                        message = "Команда ${command.joinToString(" ")} превысила timeout",
                    ),
                )
            }
            val stdout = process.inputStream.bufferedReader().readText().trim()
            val stderr = process.errorStream.bufferedReader().readText().trim()
            val output = if (readStderr && stderr.isNotBlank()) stderr else stdout.ifBlank { stderr }
            if (process.exitValue() == 0 && output.isNotBlank()) {
                CommandResult(
                    versionRaw = output,
                    check = EnvironmentDoctorCheckDto(
                        key = key,
                        status = "PASS",
                        message = output.lineSequence().firstOrNull().orEmpty(),
                    ),
                )
            } else {
                CommandResult(
                    versionRaw = null,
                    check = EnvironmentDoctorCheckDto(
                        key = key,
                        status = "FAIL",
                        message = "Команда ${command.joinToString(" ")} завершилась с кодом ${process.exitValue()}",
                    ),
                )
            }
        } catch (ex: Exception) {
            CommandResult(
                versionRaw = null,
                check = EnvironmentDoctorCheckDto(
                    key = key,
                    status = "FAIL",
                    message = "Не удалось выполнить ${command.joinToString(" ")}: ${ex.message}",
                ),
            )
        }
    }

    private fun checkExecutionRunner(): EnvironmentDoctorCheckDto {
        if (executionProperties.killSwitch) {
            return EnvironmentDoctorCheckDto(
                key = "execution_runner_mode",
                status = "WARN",
                message = "Execution kill-switch включен, запуск кода заблокирован",
            )
        }

        val mode = executionProperties.mode.lowercase()
        if (mode != "isolated") {
            return EnvironmentDoctorCheckDto(
                key = "execution_runner_mode",
                status = "WARN",
                message = "Используется mode='$mode'. Для production рекомендуется isolated runner",
                details = mapOf(
                    "fallbackToLocal" to executionProperties.fallbackToLocal.toString(),
                ),
            )
        }

        val healthUrl = executionProperties.isolatedUrl.removeSuffix("/api/execute") + "/health"
        return runCatching {
            val body = restClientBuilder.build()
                .get()
                .uri(healthUrl)
                .accept(MediaType.APPLICATION_JSON)
                .retrieve()
                .body(String::class.java)
                .orEmpty()
            EnvironmentDoctorCheckDto(
                key = "execution_runner_mode",
                status = "PASS",
                message = "Isolated runner доступен ($healthUrl) ${body.take(120)}",
            )
        }.getOrElse { ex ->
            EnvironmentDoctorCheckDto(
                key = "execution_runner_mode",
                status = "FAIL",
                message = "Execution mode=isolated, но runner недоступен: ${ex.message}",
                details = mapOf("url" to healthUrl),
            )
        }
    }

    private fun resolveProjectLayout(): ProjectLayout {
        val cwd = Paths.get("").toAbsolutePath().normalize()
        val backendDir = when {
            Files.exists(cwd.resolve("pom.xml")) -> cwd
            Files.exists(cwd.resolve("backend/pom.xml")) -> cwd.resolve("backend")
            else -> cwd
        }
        val rootDir = if (backendDir.fileName?.toString() == "backend") {
            backendDir.parent ?: backendDir
        } else {
            cwd
        }
        return ProjectLayout(rootDir = rootDir, backendDir = backendDir)
    }

    private fun readFile(path: Path): String {
        return runCatching {
            Files.readString(path)
        }.getOrDefault("")
    }

    private fun extractFirst(source: String, regex: Regex): String? {
        return regex.find(source)?.groupValues?.getOrNull(1)
    }

    private fun extractJavaMajor(versionText: String?): Int? {
        if (versionText.isNullOrBlank()) return null
        val normalized = versionText.lowercase()
        val version = Regex("version \"(\\d+)(?:[.\\d_-]*)\"").find(normalized)?.groupValues?.getOrNull(1)
            ?: Regex("openjdk (\\d+)").find(normalized)?.groupValues?.getOrNull(1)
            ?: Regex("(\\d+)").find(normalized)?.groupValues?.getOrNull(1)
        return version?.toIntOrNull()
    }

    private fun compareVersions(left: String, right: String): Int {
        val leftParts = left.split('.', '-', '_').mapNotNull { it.toIntOrNull() }
        val rightParts = right.split('.', '-', '_').mapNotNull { it.toIntOrNull() }
        val max = maxOf(leftParts.size, rightParts.size)
        for (index in 0 until max) {
            val l = leftParts.getOrElse(index) { 0 }
            val r = rightParts.getOrElse(index) { 0 }
            if (l != r) return l.compareTo(r)
        }
        return 0
    }

    private data class CommandResult(
        val versionRaw: String?,
        val check: EnvironmentDoctorCheckDto,
    )

    private data class ProjectLayout(
        val rootDir: Path,
        val backendDir: Path,
    )
}
