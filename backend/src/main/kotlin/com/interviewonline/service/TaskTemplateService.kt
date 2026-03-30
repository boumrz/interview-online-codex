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
        val supported = listOf("nodejs", "python", "kotlin", "java", "sql")
        return supported.associateWith { seedsForLanguage(it) }
    }

    private fun normalizeLanguage(language: String): String {
        return when (language.lowercase()) {
            "javascript", "typescript", "nodejs" -> "nodejs"
            "python" -> "python"
            "kotlin" -> "kotlin"
            "java" -> "java"
            "sql" -> "sql"
            else -> "nodejs"
        }
    }

    private fun seedsForLanguage(language: String): List<TemplateSeed> {
        return when (language) {
            "nodejs" -> jsSeeds()
            "python" -> pythonSeeds()
            "kotlin" -> kotlinSeeds()
            "java" -> javaSeeds()
            "sql" -> sqlSeeds()
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

    private fun javaSeeds(): List<TemplateSeed> {
        return listOf(
            TemplateSeed(
                title = "CodeRun · A+B",
                description = "Реализуйте метод, возвращающий сумму двух чисел.",
                starterCode = "public class Solution {\n    public static int solve(int a, int b) {\n        return a + b;\n    }\n}\n",
            ),
            TemplateSeed(
                title = "CodeRun · Палиндром",
                description = "Верните true, если строка является палиндромом.",
                starterCode = "public class Solution {\n    public static boolean isPalindrome(String s) {\n        // TODO\n        return false;\n    }\n}\n",
            ),
            TemplateSeed(
                title = "CodeRun · Two Sum",
                description = "Верните индексы двух элементов массива с суммой target.",
                starterCode = "import java.util.*;\n\npublic class Solution {\n    public static int[] twoSum(int[] nums, int target) {\n        // TODO\n        return new int[0];\n    }\n}\n",
            ),
            TemplateSeed(
                title = "CodeRun · Валидные скобки",
                description = "Проверьте корректность последовательности скобок.",
                starterCode = "import java.util.*;\n\npublic class Solution {\n    public static boolean isValidBrackets(String s) {\n        // TODO\n        return false;\n    }\n}\n",
            ),
            TemplateSeed(
                title = "CodeRun · Merge Intervals",
                description = "Слейте пересекающиеся интервалы.",
                starterCode = "import java.util.*;\n\npublic class Solution {\n    public static int[][] mergeIntervals(int[][] intervals) {\n        // TODO\n        return new int[0][0];\n    }\n}\n",
            ),
        )
    }

    private fun sqlSeeds(): List<TemplateSeed> {
        return listOf(
            TemplateSeed(
                title = "SQL · Найти дубли email",
                description = "Выведите email, которые встречаются больше одного раза в таблице users.",
                starterCode = "SELECT email\nFROM users\nGROUP BY email\nHAVING COUNT(*) > 1;\n",
            ),
            TemplateSeed(
                title = "SQL · Топ 3 зарплаты",
                description = "Найдите трёх сотрудников с максимальной зарплатой.",
                starterCode = "SELECT id, name, salary\nFROM employees\nORDER BY salary DESC\nLIMIT 3;\n",
            ),
            TemplateSeed(
                title = "SQL · Заказы за 30 дней",
                description = "Выведите количество заказов по дням за последние 30 дней.",
                starterCode = "SELECT DATE(created_at) AS day, COUNT(*) AS orders_count\nFROM orders\nWHERE created_at >= CURRENT_DATE - INTERVAL '30 day'\nGROUP BY DATE(created_at)\nORDER BY day;\n",
            ),
            TemplateSeed(
                title = "SQL · Клиенты без заказов",
                description = "Найдите клиентов, у которых нет ни одного заказа.",
                starterCode = "SELECT c.id, c.name\nFROM customers c\nLEFT JOIN orders o ON o.customer_id = c.id\nWHERE o.id IS NULL;\n",
            ),
            TemplateSeed(
                title = "SQL · Конверсия воронки",
                description = "Посчитайте количество пользователей на каждом этапе воронки.",
                starterCode = "SELECT stage, COUNT(DISTINCT user_id) AS users_count\nFROM funnel_events\nGROUP BY stage\nORDER BY stage;\n",
            ),
        )
    }
}
