package com.interviewonline.service

import com.interviewonline.model.RoomTask
import org.springframework.stereotype.Service

@Service
class TaskTemplateService {
    data class TemplateSeed(
        val title: String,
        val description: String,
        val starterCode: String,
    )

    fun defaultRoomTasks(language: String): List<RoomTask> {
        val normalizedLanguage = normalizeLanguage(language)
        return seedsForLanguage(normalizedLanguage).mapIndexed { index, seed ->
            RoomTask(
                stepIndex = index,
                title = seed.title,
                description = seed.description,
                starterCode = seed.starterCode,
                language = normalizedLanguage,
                categoryName = normalizedLanguage,
            )
        }
    }

    fun catalogByLanguage(): Map<String, List<TemplateSeed>> {
        val supported = listOf("javascript", "typescript", "python", "kotlin")
        return supported.associateWith { seedsForLanguage(it) }
    }

    private fun normalizeLanguage(language: String): String {
        return when (language.lowercase()) {
            "python" -> "python"
            "kotlin" -> "kotlin"
            "typescript" -> "typescript"
            else -> "javascript"
        }
    }

    private fun seedsForLanguage(language: String): List<TemplateSeed> {
        return when (language) {
            "python" -> pythonSeeds()
            "kotlin" -> kotlinSeeds()
            "typescript" -> tsSeeds()
            else -> jsSeeds()
        }
    }

    private fun jsSeeds(): List<TemplateSeed> {
        return listOf(
            TemplateSeed(
                title = "CodeRun · A+B",
                description = "Реализуйте функцию, которая принимает два целых числа и возвращает их сумму.",
                starterCode = "function solve(a, b) {\n  return a + b;\n}\n",
            ),
            TemplateSeed(
                title = "CodeRun · Палиндром",
                description = "Верните true, если строка читается одинаково слева направо и справа налево.",
                starterCode = "function isPalindrome(s) {\n  // TODO\n  return false;\n}\n",
            ),
            TemplateSeed(
                title = "CodeRun · Two Sum",
                description = "Верните индексы двух элементов массива, сумма которых равна target.",
                starterCode = "function twoSum(nums, target) {\n  // TODO\n  return [];\n}\n",
            ),
            TemplateSeed(
                title = "CodeRun · Валидные скобки",
                description = "Проверьте, что последовательность скобок корректна.",
                starterCode = "function isValidBrackets(s) {\n  // TODO\n  return false;\n}\n",
            ),
            TemplateSeed(
                title = "CodeRun · Merge Intervals",
                description = "Слейте пересекающиеся интервалы и верните упорядоченный результат.",
                starterCode = "function mergeIntervals(intervals) {\n  // TODO\n  return [];\n}\n",
            ),
        )
    }

    private fun tsSeeds(): List<TemplateSeed> {
        return listOf(
            TemplateSeed(
                title = "CodeRun · A+B",
                description = "Реализуйте функцию, которая принимает два числа и возвращает сумму.",
                starterCode = "function solve(a: number, b: number): number {\n  return a + b;\n}\n",
            ),
            TemplateSeed(
                title = "CodeRun · Палиндром",
                description = "Верните true, если строка является палиндромом.",
                starterCode = "function isPalindrome(s: string): boolean {\n  // TODO\n  return false;\n}\n",
            ),
            TemplateSeed(
                title = "CodeRun · Two Sum",
                description = "Найдите индексы двух элементов с суммой target.",
                starterCode = "function twoSum(nums: number[], target: number): number[] {\n  // TODO\n  return [];\n}\n",
            ),
            TemplateSeed(
                title = "CodeRun · Валидные скобки",
                description = "Проверьте корректность последовательности скобок.",
                starterCode = "function isValidBrackets(s: string): boolean {\n  // TODO\n  return false;\n}\n",
            ),
            TemplateSeed(
                title = "CodeRun · Merge Intervals",
                description = "Слейте пересекающиеся интервалы.",
                starterCode = "function mergeIntervals(intervals: Array<[number, number]>): Array<[number, number]> {\n  // TODO\n  return [];\n}\n",
            ),
        )
    }

    private fun pythonSeeds(): List<TemplateSeed> {
        return listOf(
            TemplateSeed(
                title = "CodeRun · A+B",
                description = "Реализуйте функцию, возвращающую сумму двух чисел.",
                starterCode = "def solve(a: int, b: int) -> int:\n    return a + b\n",
            ),
            TemplateSeed(
                title = "CodeRun · Палиндром",
                description = "Верните True, если строка является палиндромом.",
                starterCode = "def is_palindrome(s: str) -> bool:\n    # TODO\n    return False\n",
            ),
            TemplateSeed(
                title = "CodeRun · Two Sum",
                description = "Верните индексы двух элементов массива с суммой target.",
                starterCode = "def two_sum(nums: list[int], target: int) -> list[int]:\n    # TODO\n    return []\n",
            ),
            TemplateSeed(
                title = "CodeRun · Валидные скобки",
                description = "Проверьте корректность последовательности скобок.",
                starterCode = "def is_valid_brackets(s: str) -> bool:\n    # TODO\n    return False\n",
            ),
            TemplateSeed(
                title = "CodeRun · Merge Intervals",
                description = "Слейте пересекающиеся интервалы.",
                starterCode = "def merge_intervals(intervals: list[list[int]]) -> list[list[int]]:\n    # TODO\n    return []\n",
            ),
        )
    }

    private fun kotlinSeeds(): List<TemplateSeed> {
        return listOf(
            TemplateSeed(
                title = "CodeRun · A+B",
                description = "Реализуйте функцию, возвращающую сумму двух чисел.",
                starterCode = "fun solve(a: Int, b: Int): Int {\n    return a + b\n}\n",
            ),
            TemplateSeed(
                title = "CodeRun · Палиндром",
                description = "Верните true, если строка является палиндромом.",
                starterCode = "fun isPalindrome(s: String): Boolean {\n    // TODO\n    return false\n}\n",
            ),
            TemplateSeed(
                title = "CodeRun · Two Sum",
                description = "Верните индексы двух элементов массива с суммой target.",
                starterCode = "fun twoSum(nums: IntArray, target: Int): IntArray {\n    // TODO\n    return intArrayOf()\n}\n",
            ),
            TemplateSeed(
                title = "CodeRun · Валидные скобки",
                description = "Проверьте корректность последовательности скобок.",
                starterCode = "fun isValidBrackets(s: String): Boolean {\n    // TODO\n    return false\n}\n",
            ),
            TemplateSeed(
                title = "CodeRun · Merge Intervals",
                description = "Слейте пересекающиеся интервалы.",
                starterCode = "fun mergeIntervals(intervals: List<IntRange>): List<IntRange> {\n    // TODO\n    return emptyList()\n}\n",
            ),
        )
    }
}
